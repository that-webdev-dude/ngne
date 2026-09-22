interface Driver {
    send(method: string, params?: object): Promise<unknown>;
    evaluate<T>(expression: string, userGesture?: boolean): Promise<T>;
}

/** Select through the real UI; older installed fixtures still start automatically. */
export async function chooseSession(cdp: Driver, wait: (expression: string) => Promise<void>) {
    await wait("!!document.querySelector('#retry')");
    if (!(await cdp.evaluate<boolean>("!!document.querySelector('#start')"))) return;
    await wait(
        "!document.querySelector('#start').disabled || !document.querySelector('#continue').disabled",
    );
    await cdp.evaluate(
        "document.querySelector(document.querySelector('#continue').disabled ? '#start' : '#continue').click()",
    );
}

export async function checkSessionControls(
    cdp: Driver,
    wait: (expression: string) => Promise<void>,
    check: (condition: unknown, message: string) => void,
    screenshot: (name: string) => Promise<void>,
) {
    if (!(await cdp.evaluate<boolean>("!!document.querySelector('#new-game')"))) return;
    const step = () => cdp.evaluate("window.__contentHarness.step(3)");
    async function key(code: string, key: string, type = "keyDown") {
        await cdp.send("Input.dispatchKeyEvent", {
            type,
            code,
            key,
            ...(code === "Enter" && type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}),
            windowsVirtualKeyCode:
                code === "Enter" ? 13 : code === "ArrowRight" ? 39 : code === "Tab" ? 9 : 69,
        });
    }
    await cdp.evaluate(
        "window.__contentHarness.beforeReset = localStorage.getItem(window.__contentHarness.saveKey); window.__contentHarness.failSaveReset = true; document.querySelector('#new-game').click()",
    );
    await step();
    check(
        await cdp.evaluate<boolean>(
            "window.__contentHarness.inspect().run.status === 'completed' && localStorage.getItem(window.__contentHarness.saveKey) === window.__contentHarness.beforeReset && document.querySelector('#save-status').textContent.includes('Save reset failed')",
        ),
        "New Game reset failure preserves completed session and saved bytes, with explicit failure",
    );
    await screenshot("session-reset-failed");
    await cdp.evaluate(
        "window.__contentHarness.failSaveReset = false; document.querySelector('#pause').click()",
    );
    await wait("document.querySelector('#pause').textContent === 'Resume game'");
    check(
        await cdp.evaluate<boolean>(
            "document.querySelector('#session-status').textContent.includes('Paused') && document.querySelector('#travel').disabled && document.querySelector('#checkpoint-retry').disabled && window.__contentHarness.callbacks.size === 0",
        ),
        "paused session accurately guards gameplay with no running tick",
    );
    await cdp.evaluate("document.querySelector('#new-game').focus()");
    await key("Enter", "Enter");
    await key("Enter", "Enter", "keyUp");
    await wait("window.__contentHarness.callbacks.size > 0");
    await step();
    check(
        await cdp.evaluate<boolean>(
            "window.__contentHarness.inspect().run.live.objective === 'find-relic' && window.__contentHarness.inspect().run.status === 'playing' && window.__contentHarness.snapshot().health.current === 3 && JSON.parse(localStorage.getItem(window.__contentHarness.saveKey)).completion === null && document.activeElement === document.querySelector('canvas')",
        ),
        "keyboard New Game starts from pause without a tick and creates fresh live/saved progress and canvas focus",
    );
    check(
        await cdp.evaluate<boolean>(
            "window.__contentHarness.voices.every(v => v.stops === 1) && window.__contentHarness.inspect().assets.claims.scene === 4",
        ),
        "New Game disposes old audio and leaves only fresh scene ownership",
    );
    await screenshot("session-new-game");

    // Real keyboard events target a control while simulation keeps ticking.
    await cdp.evaluate(
        "document.querySelector('#travel').focus(); window.__contentHarness.uiX = window.__contentHarness.snapshot().actors[0].x",
    );
    await key("ArrowRight", "ArrowRight");
    await key("KeyE", "e");
    await step();
    check(
        await cdp.evaluate<boolean>(
            "window.__contentHarness.snapshot().actors[0].x === window.__contentHarness.uiX && document.querySelector('#room').textContent === 'Town courtyard' && document.querySelector('#loading').textContent === 'Room ready.'",
        ),
        "keyboard navigation on UI neither moves the player nor triggers E travel",
    );
    await key("ArrowRight", "ArrowRight", "keyUp");
    await key("KeyE", "e", "keyUp");
    await key("Enter", "Enter");
    await key("Enter", "Enter", "keyUp");
    await wait("document.querySelector('#loading').textContent.includes('Activating')");
    await cdp.evaluate(
        "document.querySelector('#travel').click(); document.querySelector('#checkpoint-retry').click()",
    );
    await step();
    check(
        await cdp.evaluate<boolean>(
            "document.querySelector('#room').textContent === 'Dungeon threshold' && window.__contentHarness.inspect().assets.claims.scene === 4",
        ),
        "keyboard Travel and repeated/conflicting clicks mount exactly one destination",
    );

    await cdp.evaluate(
        "window.__contentHarness.holdImage = true; document.querySelector('#travel').click()",
    );
    // Town content may be retained: New Game also invalidates an already-ready candidate.
    await wait(
        "window.__contentHarness.imageWaiting || document.querySelector('#loading').textContent.includes('Activating')",
    );
    await cdp.evaluate(
        "window.__contentHarness.holdImage = false; document.querySelector('#new-game').click(); document.querySelector('#new-game').click(); if(window.__contentHarness.imageWaiting) window.__contentHarness.releaseImage()",
    );
    await wait(
        "window.__contentHarness.callbacks.size > 0 && !document.querySelector('#pause').disabled",
    );
    await step();
    check(
        await cdp.evaluate<boolean>(
            "document.querySelector('#room').textContent === 'Town courtyard' && window.__contentHarness.inspect().assets.claims.scene === 4 && window.__contentHarness.inspect().run.live.objective === 'find-relic'",
        ),
        "New Game invalidates loading/ready work and repeated activation leaves one fresh session",
    );

    await cdp.send("Page.reload", { ignoreCache: true });
    await wait("document.querySelector('#continue')?.disabled === false");
    check(
        await cdp.evaluate<boolean>(
            "document.querySelector('#start').disabled && document.querySelector('#room').textContent === 'No active room' && window.__contentHarness.callbacks.size === 0",
        ),
        "reload offers Continue before starting simulation",
    );
    await screenshot("session-continue");
    await cdp.evaluate(
        "window.__contentHarness.menuSave = localStorage.getItem(window.__contentHarness.saveKey); window.__contentHarness.failSaveReset = true; document.querySelector('#new-game').click()",
    );
    check(
        await cdp.evaluate<boolean>(
            "!document.querySelector('#continue').disabled && document.querySelector('#save-status').textContent.includes('Save reset failed') && localStorage.getItem(window.__contentHarness.saveKey) === window.__contentHarness.menuSave && window.__contentHarness.callbacks.size === 0",
        ),
        "menu reset failure retains saved bytes and leaves Continue available without creating a game",
    );
    await cdp.evaluate("window.__contentHarness.failSaveReset = false");
    await cdp.evaluate("document.querySelector('#continue').focus()");
    await key("Enter", "Enter");
    await key("Enter", "Enter", "keyUp");
    await wait("window.__contentHarness.imageWaiting");
    await cdp.evaluate("window.__contentHarness.releaseImage()");
    await wait("window.__contentHarness.callbacks.size > 0");
    await step();
    check(
        await cdp.evaluate<boolean>(
            "document.querySelector('#room').textContent === 'Town courtyard' && document.activeElement === document.querySelector('canvas') && document.querySelector('#continue').disabled",
        ),
        "keyboard Continue initializes once without an existing tick and restores canvas focus",
    );
    await cdp.evaluate("localStorage.removeItem(window.__contentHarness.saveKey)");
    await cdp.send("Page.reload", { ignoreCache: true });
    await wait("document.querySelector('#start')?.disabled === false");
    check(
        await cdp.evaluate<boolean>(
            "document.querySelector('#continue').disabled && window.__contentHarness.callbacks.size === 0 && localStorage.getItem(window.__contentHarness.saveKey) === null",
        ),
        "missing save offers Start without creating a simulation or automatic save",
    );
    await key("Tab", "Tab");
    await key("Tab", "Tab", "keyUp");
    check(
        await cdp.evaluate<boolean>("document.activeElement === document.querySelector('#start')"),
        "Tab reaches Start as the first available keyboard action",
    );
    await key("Enter", "Enter");
    await key("Enter", "Enter", "keyUp");
    await wait("window.__contentHarness.imageWaiting");
    await cdp.evaluate(
        "document.querySelector('#start').click(); document.querySelector('#continue').click()",
    );
    check(
        await cdp.evaluate<boolean>(
            "document.querySelector('#start').disabled && document.querySelector('#continue').disabled && document.querySelector('#travel').disabled && document.querySelector('#session-status').textContent.includes('Starting')",
        ),
        "loading session guards repeated Start, Continue and travel while no tick runs",
    );
    await cdp.evaluate("window.__contentHarness.releaseImage()");
    await wait("window.__contentHarness.callbacks.size > 0");
    await step();
    check(
        await cdp.evaluate<boolean>(
            "document.querySelector('#room').textContent === 'Town courtyard' && window.__contentHarness.inspect().assets.claims.scene === 4 && document.activeElement === document.querySelector('canvas')",
        ),
        "keyboard-only Tab/Enter Start mounts once and focuses the canvas",
    );
    await cdp.send("Page.reload", { ignoreCache: true });
    await wait("document.querySelector('#continue')?.disabled === false");
    await cdp.evaluate("document.querySelector('#new-game').click()");
    await wait("window.__contentHarness.imageWaiting");
    await cdp.evaluate("window.__contentHarness.releaseImage()");
    await wait("window.__contentHarness.callbacks.size > 0");
    await step();
    await cdp.evaluate(
        "window.__contentHarness.oldDevice = window.__contentHarness.devices.at(-1); document.querySelector('#new-game').click(); document.querySelector('#new-game').click()",
    );
    await wait(
        "window.__contentHarness.callbacks.size > 0 && !document.querySelector('#pause').disabled",
    );
    await step();
    check(
        await cdp.evaluate<boolean>(
            "window.__contentHarness.callbacks.size === 1 && window.__contentHarness.inspect().assets.claims.scene === 4 && document.querySelector('#room').textContent === 'Town courtyard'",
        ),
        "menu New Game retires selection handlers: another New Game leaves exactly one running session",
    );
    await cdp.evaluate("window.__contentHarness.oldDevice.lost");
    check(true, "the session created by menu New Game releases its device on the next New Game");
}
