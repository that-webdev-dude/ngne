import { chooseSession } from "./browser-session-checks.js";

interface Driver {
    send(method: string, params?: object): Promise<unknown>;
    evaluate<T>(expression: string, userGesture?: boolean): Promise<T>;
}

/** Uses the runner's disposable browser profile and the consumer's base-scoped slot. */
export async function checkInstalledSaves(
    cdp: Driver,
    wait: (expression: string) => Promise<void>,
    check: (condition: unknown, message: string) => void,
    walk: (code: string, ticks: number) => Promise<void>,
    screenshot: (name: string) => Promise<void>,
): Promise<void> {
    async function capture(name: string) {
        await cdp.evaluate(
            "document.querySelector('#save-status').scrollIntoView({block:'center'})",
        );
        await screenshot(name);
    }
    async function reload() {
        await cdp.send("Page.reload", { ignoreCache: true });
        await chooseSession(cdp, wait);
        await wait("window.__contentHarness?.imageWaiting === true");
        await cdp.evaluate("window.__contentHarness.releaseImage()");
        await wait("window.__contentHarness.callbacks.size > 0");
        await cdp.evaluate("window.__contentHarness.step(2)");
    }
    async function travel() {
        await cdp.evaluate("document.querySelector('#travel').click()");
        await wait("document.querySelector('#loading').textContent.includes('Activating')");
        await cdp.evaluate("window.__contentHarness.step(2)");
    }
    await travel();
    await walk("ArrowUp", 40);
    await walk("ArrowLeft", 200);
    check(
        await cdp.evaluate<boolean>(`(() => {
        const s = window.__contentHarness, save = JSON.parse(localStorage.getItem(s.saveKey));
        return s.inspect().run.live.objective === 'return-relic' && save.checkpoint.progress.objective === 'find-relic' && save.completion === null;
    })()`),
        "save projection excludes post-checkpoint relic collection",
    );
    await reload();
    check(
        await cdp.evaluate<boolean>(`(() => {
        const s = window.__contentHarness, run = s.inspect().run, resources = s.snapshot();
        return document.querySelector('#save-status').textContent.includes('Continued saved checkpoint') &&
            run.status === 'playing' && run.live.objective === 'find-relic' && resources.actors[0].x === 80 && resources.actors[0].y === 160 && resources.health.current === 3;
    })()`),
        "real same-origin reload restores checkpoint and reconstructs full-health Town",
    );
    await travel();
    check(
        await cdp.evaluate<boolean>(
            "window.__contentHarness.snapshot().roomFacts.items.some(item => item.id === 'relic')",
        ),
        "reload rolls back live collection and reconstructs the relic",
    );
    await walk("ArrowUp", 40);
    await walk("ArrowLeft", 200);
    await travel();
    await cdp.evaluate("window.__contentHarness.step(2)");
    check(
        await cdp.evaluate<boolean>(`(() => {
        const s = window.__contentHarness, save = JSON.parse(localStorage.getItem(s.saveKey));
        return s.inspect().run.status === 'completed' && save.checkpoint.progress.objective === 'return-relic' && save.completion.objective === 'complete';
    })()`),
        "Town captures before completing and persists both committed facts",
    );
    await reload();
    check(
        await cdp.evaluate<boolean>(
            "window.__contentHarness.inspect().run.status === 'completed' && document.querySelector('#objective').textContent.includes('Run complete') && document.querySelector('#save-status').textContent.includes('Continued completed run')",
        ),
        "real reload preserves completed result and visible completion",
    );
    await capture("save-completed-reload");
    await travel();
    check(
        await cdp.evaluate<boolean>(
            "window.__contentHarness.snapshot().roomFacts.items.length === 0",
        ),
        "continued completion reconstructs the collected relic as absent",
    );

    for (const invalid of ["{invalid", '{"version":999,"checkpoint":{},"completion":null}']) {
        await cdp.evaluate(
            `localStorage.setItem(window.__contentHarness.saveKey, ${JSON.stringify(invalid)})`,
        );
        await reload();
        check(
            await cdp.evaluate<boolean>(
                `document.querySelector('#save-status').textContent.includes('Save rejected') && window.__contentHarness.inspect().run.live.objective === 'find-relic' && localStorage.getItem(window.__contentHarness.saveKey) === ${JSON.stringify(invalid)}`,
            ),
            "invalid/unsupported save visibly falls back without overwriting rejected data",
        );
        await walk("ArrowRight", 3);
        check(
            await cdp.evaluate<boolean>("window.__contentHarness.snapshot().actors[0].x > 80"),
            "invalid save fallback remains playable",
        );
        await capture("save-invalid-fallback");
        await cdp.evaluate("document.querySelector('#save').click()");
        check(
            await cdp.evaluate<boolean>(
                "document.querySelector('#save-status').textContent.includes('Checkpoint/completion saved') && JSON.parse(localStorage.getItem(window.__contentHarness.saveKey)).version === 1",
            ),
            "deliberate save replaces invalid data with accepted current checkpoint",
        );
    }
    await cdp.evaluate("sessionStorage.setItem('save-read-failure', 'yes')");
    await reload();
    check(
        await cdp.evaluate<boolean>(
            "document.querySelector('#save-status').textContent.includes('Save read failed') && !document.querySelector('#travel').disabled",
        ),
        "controlled storage read failure leaves a visible playable fallback",
    );
    await cdp.evaluate(
        "window.__contentHarness.failSaveRead = false; sessionStorage.removeItem('save-read-failure'); document.querySelector('#save').click()",
    );
    await cdp.evaluate(
        "window.__contentHarness.savedBefore = localStorage.getItem(window.__contentHarness.saveKey); window.__contentHarness.failSaveWrite = true",
    );
    await travel();
    await walk("ArrowUp", 40);
    await walk("ArrowLeft", 200);
    await travel();
    await cdp.evaluate("window.__contentHarness.step(2)");
    check(
        await cdp.evaluate<boolean>(
            "document.querySelector('#save-status').textContent.includes('Save write failed') && window.__contentHarness.inspect().run.status === 'completed' && localStorage.getItem(window.__contentHarness.saveKey) === window.__contentHarness.savedBefore",
        ),
        "controlled completion write failure preserves old save and current completed session",
    );
    await walk("ArrowRight", 3);
    check(
        await cdp.evaluate<boolean>("window.__contentHarness.snapshot().actors[0].x > 80"),
        "write failure leaves in-session movement usable",
    );
    await capture("save-write-failure");
    await cdp.evaluate(
        "window.__contentHarness.failSaveWrite = false; document.querySelector('#save').click()",
    );
    check(
        await cdp.evaluate<boolean>(
            "document.querySelector('#save-status').textContent.includes('Checkpoint/completion saved') && JSON.parse(localStorage.getItem(window.__contentHarness.saveKey)).completion.objective === 'complete'",
        ),
        "deliberate retry reports success only after storage accepts completion",
    );
    await reload();
    check(
        await cdp.evaluate<boolean>("window.__contentHarness.inspect().run.status === 'completed'"),
        "recovered write survives another real reload",
    );
}
