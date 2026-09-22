import { writeFileSync } from "node:fs";

interface Driver {
    evaluate<T>(expression: string, userGesture?: boolean): Promise<T>;
}

/** Production UI and browser-platform injection only; the caller restores content in finally. */
export async function checkProgressionRaces(
    cdp: Driver,
    wait: (expression: string) => Promise<void>,
    check: (condition: unknown, message: string) => void,
    walk: (code: string, ticks: number) => Promise<void>,
    screenshot: (name: string) => Promise<void>,
    townPath: string,
    originalTown: string,
) {
    const step = (count = 1) => cdp.evaluate(`window.__contentHarness.step(${count})`);
    async function ready(button = "travel") {
        await cdp.evaluate(`document.querySelector('#${button}').click()`);
        await wait("document.querySelector('#loading').textContent.includes('Activating')");
    }
    async function verify(expression: string, label: string) {
        check(
            await cdp.evaluate<boolean>(
                `(() => { const s = window.__contentHarness, d = s.inspect(); return ${expression}; })()`,
            ),
            `progression races: ${label}`,
        );
    }
    await cdp.evaluate("document.querySelector('#audio').click()", true);
    await wait("document.querySelector('#playback').textContent.includes('Playback requested')");
    await step(2);
    await ready();
    await step(2);
    await walk("ArrowUp", 40);
    await walk("ArrowLeft", 190);
    await verify(
        "d.run.live.objective === 'find-relic' && s.snapshot().actors[0].x === 140",
        "authored player is one tick outside relic contact",
    );

    // The decoded-audio instance check runs during private setup, after state commit.
    await ready();
    await cdp.evaluate("window.__contentHarness.failMount = true");
    await walk("ArrowLeft", 1);
    await verify(
        "s.mountFailures === 1 && d.lifecycle === 'Running' && document.querySelector('#room').textContent === 'Dungeon threshold' && d.run.live.objective === 'return-relic' && d.run.live.collectedItems.length === 1 && d.assets.claims.scene === 4 && s.voices.filter(v => v.stops === 0).length === 1",
        "collection commits before failed private Town mount; old scene, claims and one voice survive",
    );
    await walk("ArrowRight", 1);
    await verify(
        "s.snapshot().actors[0].x === 140 && s.snapshot().roomFacts.items.length === 0",
        "failed mount leaves movement usable and refreshes committed item presentation",
    );

    writeFileSync(townPath, "{controlled-invalid");
    await cdp.evaluate("document.querySelector('#retry').click()");
    await wait("document.querySelector('#loading').textContent.includes('Content failed')");
    await verify(
        "d.run.live.objective === 'return-relic' && d.run.live.collectedItems.length === 1 && d.assets.claims.scene === 4 && document.querySelector('#room').textContent === 'Dungeon threshold'",
        "failed JSON destination preserves already committed collection and mounted ownership",
    );
    writeFileSync(townPath, originalTown);

    for (const fail of [false, true]) {
        await cdp.evaluate(
            "window.__contentHarness.holdJson = 'town.json'; document.querySelector('#retry').click()",
        );
        await wait("window.__contentHarness.jsonWaiting");
        await cdp.evaluate("document.querySelector('#cancel').click()");
        await walk("ArrowRight", 1);
        await cdp.evaluate(`window.__contentHarness.releaseJson(${fail})`);
        await wait("window.__contentHarness.jsonSettled");
        await step(2);
        await verify(
            "d.run.live.objective === 'return-relic' && d.run.live.collectedItems.length === 1 && d.assets.claims.scene === 4 && document.querySelector('#room').textContent === 'Dungeon threshold' && document.querySelector('[role=alert]').textContent === '' && s.voices.filter(v => v.stops === 0).length === 1",
            `cancelled destination ignores late JSON ${fail ? "rejection" : "success"} and retains progress/audio`,
        );
    }
    await ready("retry");
    await step(); // Mount Town without running its first update.
    await verify(
        "document.querySelector('#room').textContent === 'Town courtyard' && d.run.status === 'playing' && d.run.live.objective === 'return-relic'",
        "corrected retry mounts Town before completion dispatch",
    );
    await ready();
    await cdp.evaluate("window.__contentHarness.failMount = true");
    await step(); // Capture, completion, then a failed private Dungeon mount.
    await verify(
        "s.mountFailures === 2 && d.lifecycle === 'Running' && document.querySelector('#room').textContent === 'Town courtyard' && d.run.status === 'completed' && d.run.live.collectedItems.length === 1 && d.run.checkpoint.progress.objective === 'return-relic' && JSON.parse(localStorage.getItem(s.saveKey)).completion.objective === 'complete' && d.assets.claims.scene === 4 && s.voices.filter(v => v.stops === 0).length === 1",
        "checkpoint and completion commit and save despite failed outgoing private mount",
    );
    await screenshot("progression-failed-mount");
    await ready("retry");
    await step(2);
    await verify(
        "document.querySelector('#room').textContent === 'Dungeon threshold' && d.run.status === 'completed' && d.run.live.collectedItems.length === 1 && s.snapshot().roomFacts.items.length === 0 && d.assets.claims.scene === 4 && s.voices.filter(v => v.stops === 0).length === 1 && s.voices.every(v => v.stops <= 1)",
        "deliberate retry retains one reward, one scene and one playing voice",
    );

    // Finish old JSON work only after New Game has mounted its fresh owner and saved facts.
    for (const fail of [false, true]) {
        await cdp.evaluate(
            "window.__contentHarness.holdJson = 'town.json'; document.querySelector('#travel').click()",
        );
        await wait("window.__contentHarness.jsonWaiting");
        await cdp.evaluate("document.querySelector('#new-game').click()");
        await wait(
            "window.__contentHarness.callbacks.size > 0 && !document.querySelector('#pause').disabled",
        );
        await step(2);
        await cdp.evaluate(
            "window.__contentHarness.freshSave = localStorage.getItem(window.__contentHarness.saveKey)",
        );
        await cdp.evaluate(`window.__contentHarness.releaseJson(${fail})`);
        await wait("window.__contentHarness.jsonSettled");
        await step(2);
        await verify(
            "d.run.status === 'playing' && d.run.live.objective === 'find-relic' && d.run.live.collectedItems.length === 0 && localStorage.getItem(s.saveKey) === s.freshSave && d.assets.claims.scene === 4 && s.callbacks.size === 1 && document.querySelector('#room').textContent === 'Town courtyard' && document.querySelector('[role=alert]').textContent === '' && s.voices.every(v => v.stops === 1)",
            `New Game ignores old late JSON ${fail ? "rejection" : "success"} without overwriting fresh status, save or ownership`,
        );
        await ready();
        await step(2);
    }
    await screenshot("progression-fresh-session");
}
