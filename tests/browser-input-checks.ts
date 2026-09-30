import { BrowserGame, Input, type FrameScheduler, type InputSnapshot } from "../src/index.js";

type Check = (condition: unknown, message: string) => void;

export async function checkBrowserInput(check: Check): Promise<void> {
    const surface = document.createElement("canvas");
    surface.tabIndex = 0;
    surface.width = 100;
    surface.height = 50;
    surface.style.width = "200px";
    surface.style.height = "100px";
    surface.style.position = "absolute";
    surface.style.left = "-10000px";
    document.body.append(surface);
    surface.setPointerCapture = () => {};

    const input = new Input();
    input.attach(surface, 100, 50);
    surface.focus();
    const arrow = new KeyboardEvent("keydown", {
        code: "ArrowLeft",
        bubbles: true,
        cancelable: true,
    });
    surface.dispatchEvent(arrow);
    let snapshot = input.consume();
    check(
        arrow.defaultPrevented &&
            snapshot.held.includes("ArrowLeft") &&
            snapshot.pressed.includes("ArrowLeft"),
        "focused canvas owns keyboard input",
    );

    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const buttonSpace = new KeyboardEvent("keydown", {
        code: "Space",
        bubbles: true,
        cancelable: true,
    });
    button.dispatchEvent(buttonSpace);
    snapshot = input.consume();
    check(
        !buttonSpace.defaultPrevented &&
            !snapshot.held.includes("Space") &&
            snapshot.released.includes("ArrowLeft"),
        "leaving the canvas releases input without consuming button keys",
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    check(!input.consume().held.includes("KeyW"), "non-element keyboard targets are ignored");

    surface.focus();
    let rect = surface.getBoundingClientRect();
    surface.dispatchEvent(
        new PointerEvent("pointermove", {
            pointerId: 1,
            clientX: rect.left + rect.width * 0.75,
            clientY: rect.top + rect.height * 0.25,
            bubbles: true,
        }),
    );
    snapshot = input.consume();
    check(
        snapshot.pointer.x === 75 && snapshot.pointer.y === 12.5,
        "pointer coordinates use current canvas scaling",
    );
    surface.style.width = "400px";
    surface.style.height = "200px";
    rect = surface.getBoundingClientRect();
    surface.dispatchEvent(
        new PointerEvent("pointermove", {
            pointerId: 1,
            clientX: rect.left + rect.width * 0.25,
            clientY: rect.top + rect.height * 0.75,
            bubbles: true,
        }),
    );
    snapshot = input.consume();
    check(
        snapshot.pointer.x === 25 && snapshot.pointer.y === 37.5,
        "pointer coordinates remain logical after resize",
    );

    surface.dispatchEvent(
        new PointerEvent("pointerdown", { pointerId: 1, button: 0, bubbles: true }),
    );
    input.consume();
    surface.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 1 }));
    snapshot = input.consume();
    check(
        snapshot.released.includes("Pointer0") && !snapshot.pointer.active,
        "pointer capture loss releases canvas buttons",
    );
    surface.dispatchEvent(
        new PointerEvent("pointerdown", { pointerId: 2, button: 2, bubbles: true }),
    );
    input.consume();
    surface.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 2 }));
    snapshot = input.consume();
    check(
        snapshot.released.includes("Pointer2") && !snapshot.pointer.active,
        "pointer cancellation releases canvas buttons",
    );

    const originalGetGamepads = Object.getOwnPropertyDescriptor(navigator, "getGamepads");
    let pads: (object | undefined)[] = [];
    Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => pads,
    });
    try {
        surface.focus();
        pads = [gamepad(0, [0], [0.5])];
        snapshot = input.consume();
        check(
            snapshot.pressed.includes("Pad0") && snapshot.axes[0] === 0.5,
            "first connected controller feeds the logical player",
        );
        pads = [];
        snapshot = input.consume();
        check(
            snapshot.released.includes("Pad0") && !snapshot.held.includes("Pad0"),
            "controller disconnect releases held buttons",
        );
        pads = [undefined, gamepad(1, [9], [0])];
        snapshot = input.consume();
        check(snapshot.pressed.includes("Pad9"), "controller reconnect starts fresh input");
        button.focus();
        const released = input.consume();
        surface.focus();
        snapshot = input.consume();
        check(
            released.released.includes("Pad9") &&
                !snapshot.held.includes("Pad9") &&
                !snapshot.pressed.includes("Pad9"),
            "blurred held controller input waits for neutral",
        );
        pads = [undefined, gamepad(1, [], [0])];
        input.consume();
        pads = [undefined, gamepad(1, [9], [0])];
        check(input.consume().pressed.includes("Pad9"), "neutral controller can be reacquired");
    } finally {
        if (originalGetGamepads)
            Object.defineProperty(navigator, "getGamepads", originalGetGamepads);
        else delete (navigator as { getGamepads?: unknown }).getGamepads;
    }
    input.dispose();
    surface.remove();
    button.remove();

    await checkFrameDelivery(check);
    installNativePointerCheck();
}

async function checkFrameDelivery(check: Check): Promise<void> {
    const canvas = document.createElement("canvas");
    canvas.tabIndex = 0;
    canvas.setPointerCapture = () => {};
    canvas.style.position = "absolute";
    canvas.style.left = "-10000px";
    document.body.append(canvas);
    let callback: FrameRequestCallback = () => {};
    const scheduler: FrameScheduler = {
        request(next) {
            callback = next;
            return 1;
        },
        cancel() {},
    };
    const snapshots: InputSnapshot[] = [];
    const app = new BrowserGame({
        canvas,
        seed: 1,
        state: {},
        transition: (state) => state,
        scheduler,
    });
    await app.start(
        await app.game.prepare(
            {
                id: "input",
                setup(scene) {
                    scene.system(({ input }) => snapshots.push(input));
                },
            },
            { key: "input" },
        ),
    );
    canvas.focus();
    callback(100);
    canvas.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0 }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, button: 0 }));
    callback(108);
    check(snapshots.length === 0, "input edges wait through a zero-tick frame");
    callback(142);
    check(
        snapshots.length === 2 &&
            snapshots[0].pressed.includes("KeyD") &&
            snapshots[0].held.includes("KeyD") &&
            snapshots[1].pressed.length === 0 &&
            snapshots[1].held.includes("KeyD") &&
            snapshots[0].pointer.completed.length === 1 &&
            snapshots[1].pointer.completed.length === 0,
        "catch-up ticks consume edges once and retain held state",
    );
    canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0 }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, button: 0 }));
    await app.stop();
    canvas.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD", bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0 }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, button: 0 }));
    const resumeAudio = app.audio.resume.bind(app.audio);
    app.audio.resume = async () => {
        await resumeAudio();
        canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0 }));
        canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, button: 0 }));
    };
    await app.start();
    callback(200);
    callback(217);
    check(
        snapshots.length === 3 &&
            !snapshots[2].held.includes("KeyD") &&
            snapshots[2].released.includes("KeyD") &&
            snapshots[2].pointer.completed.length === 0,
        "stop and resume cannot retain a held key",
    );
    canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0 }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, button: 0 }));
    callback(234);
    check(snapshots[3].pointer.completed.length === 1, "fresh click completes after resume");
    await app.dispose();
    canvas.remove();
}

function gamepad(
    index: number,
    pressedButtons: readonly number[],
    axes: readonly number[],
): object {
    return {
        index,
        connected: true,
        axes,
        buttons: Array.from({ length: 10 }, (_, button) => ({
            pressed: pressedButtons.includes(button),
        })),
    };
}

function installNativePointerCheck(): void {
    const canvas = document.createElement("canvas");
    canvas.id = "native-pointer";
    canvas.tabIndex = 0;
    canvas.style.cssText = "position:fixed;left:0;top:0;width:200px;height:100px;z-index:9999";
    document.body.append(canvas);
    const input = new Input();
    input.attach(canvas, 100, 50);
    const events: { type: string; pointerId: number; trusted: boolean }[] = [];
    let pointerId = 0;
    for (const type of [
        "pointerdown",
        "gotpointercapture",
        "pointerup",
        "pointercancel",
        "lostpointercapture",
        "blur",
    ]) {
        canvas.addEventListener(type, (event) => {
            if (event instanceof PointerEvent) pointerId = event.pointerId;
            events.push({ type, pointerId, trusted: event.isTrusted });
        });
    }
    const fixture = {
        consume: () => ({ snapshot: input.consume(), events: events.splice(0) }),
        release: () => canvas.releasePointerCapture(pointerId),
        cancel: () => canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId })),
        blur: () => canvas.blur(),
        clear: () => input.clear(),
    };
    Object.assign(window, { __ngnePointer: fixture });
}
