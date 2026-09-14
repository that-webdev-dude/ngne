import { Camera } from "./primitives.js";
import { QUAD_STRIDE as STRIDE } from "./quad-layout.js";
export interface Sprite {
    x: number;
    y: number;
    width: number;
    height: number;
    color?: number;
    alpha?: number;
    rotation?: number;
    texture?: string;
    u?: number;
    v?: number;
    uw?: number;
    vh?: number;
    layer?: number;
    depth?: number;
    screen?: boolean;
}
/** Renderer input contains no entities. Ordering is scene -> layer -> depth -> insertion. */
export class Frame {
    data = new Float32Array(STRIDE * 2048);
    count = 0;
    readonly textures: (string | undefined)[] = [];
    readonly order: number[] = [];
    private layers: number[] = [];
    private depths: number[] = [];
    private scenes: number[] = [];
    private sceneIndex = -1;
    private camera = { x: 0, y: 0 };
    private snap = true;
    reset() {
        this.count = 0;
        this.sceneIndex = -1;
        // Keep backing arrays warm while packing. sort() trims the active prefix.
    }
    scene(camera: Camera, alpha: number) {
        this.sceneIndex++;
        this.camera = camera.view(alpha);
        this.snap = camera.pixelSnap;
    }
    sprite(s: Sprite) {
        this.add(
            s.x,
            s.y,
            s.width,
            s.height,
            s.color ?? 0xffffff,
            s.alpha ?? 1,
            s.layer ?? 0,
            s.depth ?? 0,
            s.texture,
            s.u ?? 0,
            s.v ?? 0,
            s.uw ?? 1,
            s.vh ?? 1,
            s.rotation ?? 0,
            s.screen ?? false,
        );
    }
    rect(
        x: number,
        y: number,
        width: number,
        height: number,
        color: number,
        alpha = 1,
        layer = 0,
        screen = false,
    ) {
        this.add(x, y, width, height, color, alpha, layer, 0, undefined, 0, 0, 1, 1, 0, screen);
    }
    private add(
        x: number,
        y: number,
        w: number,
        h: number,
        color: number,
        alpha: number,
        layer: number,
        depth: number,
        texture: string | undefined,
        u: number,
        v: number,
        uw: number,
        vh: number,
        angle: number,
        screen: boolean,
    ) {
        const i = this.count++,
            o = i * STRIDE;
        if (o + STRIDE > this.data.length) this.grow();
        if (!screen) {
            x -= this.camera.x;
            y -= this.camera.y;
        }
        if (this.snap) {
            x = Math.round(x);
            y = Math.round(y);
        }
        const d = this.data;
        packAffine(d, o, x, y, w, h, angle);
        d[o + 6] = u;
        d[o + 7] = v;
        d[o + 8] = uw;
        d[o + 9] = vh;
        d[o + 10] = ((color >>> 16) & 255) / 255;
        d[o + 11] = ((color >>> 8) & 255) / 255;
        d[o + 12] = (color & 255) / 255;
        d[o + 13] = alpha;
        this.textures[i] = texture;
        this.scenes[i] = this.sceneIndex;
        this.layers[i] = layer;
        this.depths[i] = depth;
        this.order[i] = i;
    }
    private grow() {
        const grown = new Float32Array(this.data.length * 2);
        grown.set(this.data);
        this.data = grown;
    }
    sort() {
        this.order.length = this.count;
        this.textures.length = this.count;
        this.order.sort(
            (a, b) =>
                this.scenes[a] - this.scenes[b] ||
                this.layers[a] - this.layers[b] ||
                this.depths[a] - this.depths[b] ||
                a - b,
        );
    }
}
/**
 * Writes a centered rectangle as translation plus column vectors. Kept separate so
 * Frame.add stays within V8's default inlining budget in hot authoring loops.
 */
function packAffine(
    d: Float32Array,
    o: number,
    x: number,
    y: number,
    w: number,
    h: number,
    angle: number,
): void {
    const c = Math.cos(angle),
        s = Math.sin(angle);
    const ix = c * w,
        iy = s * w,
        jx = -s * h,
        jy = c * h;
    d[o] = x - (ix + jx) / 2;
    d[o + 1] = y - (iy + jy) / 2;
    d[o + 2] = ix;
    d[o + 3] = iy;
    d[o + 4] = jx;
    d[o + 5] = jy;
}
