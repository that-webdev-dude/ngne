interface PointerSample {
    snapshot: {
        held: string[];
        pointer: {
            completed: { button: number; startX: number; startY: number; x: number; y: number }[];
        };
    };
    events: { type: string; pointerId: number; trusted: boolean }[];
}
interface Client {
    send(method: string, params?: object): Promise<unknown>;
    evaluate<T>(expression: string, userGesture?: boolean): Promise<T>;
}

export async function checkNativePointer(
    client: Client,
    evidence: unknown[] = [],
): Promise<unknown[]> {
    const mouse = (type: string, x = 50, y = 50) =>
        client.send("Input.dispatchMouseEvent", {
            type,
            x,
            y,
            button: type === "mouseMoved" ? "none" : "left",
            buttons: type === "mousePressed" ? 1 : 0,
            clickCount: 1,
        });
    const sample = async (label: string, expected: number) => {
        const value = await client.evaluate<PointerSample>("window.__ngnePointer.consume()");
        const activations = value.snapshot.pointer.completed.filter(
            (c) =>
                c.button === 0 &&
                c.startX >= 20 &&
                c.startX <= 30 &&
                c.startY >= 20 &&
                c.startY <= 30 &&
                c.x >= 20 &&
                c.x <= 30 &&
                c.y >= 20 &&
                c.y <= 30,
        ).length;
        evidence.push({ label, ...value, activations });
        if (activations !== expected || value.snapshot.held.includes("Pointer0"))
            throw Error(
                `Native pointer ${label}: expected ${expected} activations, got ${activations}`,
            );
        return value;
    };
    const click = async () => {
        await mouse("mousePressed");
        await mouse("mouseReleased");
    };
    await mouse("mousePressed");
    const down = await client.evaluate<PointerSample>("window.__ngnePointer.consume()");
    evidence.push({ label: "normal press tick", ...down, activations: 0 });
    await mouse("mouseReleased");
    const normal = await sample("normal click", 1);
    if (
        ![...down.events, ...normal.events].some(
            (e) => e.type === "gotpointercapture" && e.trusted,
        ) ||
        !normal.events.some((e) => e.type === "lostpointercapture" && e.trusted)
    )
        throw Error("Native capture event order was not observed");
    await click();
    await sample("fast click with native capture loss", 1);
    await sample("consumed once", 0);
    await mouse("mousePressed");
    await mouse("mouseReleased", 150);
    await mouse("mouseMoved");
    await sample("release outside then move inside", 0);
    for (const ending of ["release", "blur", "cancel", "clear"]) {
        await mouse("mousePressed");
        // A real move processes pending capture before explicit release.
        await client.send("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: 51,
            y: 50,
            button: "left",
            buttons: 1,
        });
        await client.evaluate(
            "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        );
        await client.evaluate(`window.__ngnePointer.${ending}()`);
        if (ending === "release") {
            await client.send("Input.dispatchMouseEvent", {
                type: "mouseMoved",
                x: 52,
                y: 50,
                button: "left",
                buttons: 1,
            });
            await client.evaluate(
                "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
            );
        }
        await mouse("mouseReleased");
        const interrupted = await sample(
            ending === "cancel"
                ? "synthetic cancellation and native late up"
                : `${ending} and late up`,
            0,
        );
        if (
            ending === "release" &&
            !interrupted.events.some((e) => e.type === "lostpointercapture" && e.trusted)
        )
            throw Error("Explicit native capture loss missing");
        if (ending === "blur" && !interrupted.events.some((e) => e.type === "blur" && e.trusted))
            throw Error("Native canvas blur missing");
        await click();
        await sample(`fresh click after ${ending}`, 1);
    }
    await click();
    await client.evaluate("window.__ngnePointer.clear()");
    await sample("pending completion cleared", 0);
    return evidence;
}
