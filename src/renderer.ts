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
const SNAP_GRID = 2 ** 20;
/** Renderer input contains no entities. Ordering is scene -> layer -> depth -> insertion. */
export class Frame {
    data = new Float32Array(STRIDE * 2048);
    count = 0;
    readonly textures: (string | undefined)[] = [];
    readonly order: number[] = [];
    private layers: number[] = [];
    private depths: number[] = [];
    private scenes: number[] = [];
    private sortIndices?: Uint32Array;
    private layerCursors?: Uint32Array;
    private sceneIndex = -1;
    private camera = { x: 0, y: 0, zoom: 1 };
    private snap = true;
    reset() {
        this.count = 0;
        this.sceneIndex = -1;
        // Keep backing arrays warm while packing. sort() trims the active prefix.
    }
    scene(camera: Camera, alpha: number) {
        // view() validates zoom before this frame records the scene.
        this.camera = camera.view(alpha);
        this.sceneIndex++;
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
            // Scale about the viewport's top-left; snapping then works in screen pixels.
            // Multiplying by a zoom of exactly 1 leaves every value bit-identical.
            const camera = this.camera,
                zoom = camera.zoom;
            x = (x - camera.x) * zoom;
            y = (y - camera.y) * zoom;
            w *= zoom;
            h *= zoom;
        }
        this.packAffine(o, x, y, w, h, angle);
        const d = this.data;
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
        if (this.count >= 32768 && this.count <= 262144 && this.sortLayers()) return;
        this.order.sort(
            (a, b) =>
                this.scenes[a] - this.scenes[b] ||
                this.layers[a] - this.layers[b] ||
                this.depths[a] - this.depths[b] ||
                a - b,
        );
    }
    /** Single-scene/common-depth identity input reduces the key to layer -> insertion. */
    private sortLayers(): boolean {
        const count = this.count,
            order = this.order,
            layers = this.layers,
            scene = this.scenes[0],
            depth = this.depths[0];
        if (!Number.isFinite(scene) || !Number.isFinite(depth)) return false;
        let min = layers[0],
            max = min,
            ordered = true;
        // Do not mutate order or allocate scratch until every fallback guard passes.
        for (let i = 0; i < count; i++) {
            const layer = layers[i];
            if (order[i] !== i || this.scenes[i] !== scene || !Number.isSafeInteger(layer))
                return false;
            if (this.depths[i] !== depth)
                return ordered && this.isDepthTailOrdered(i, scene, min, max);
            // With a common depth, nondecreasing layers prove insertion-order input sorted.
            // Interleaved input stops this comparison at its first inversion.
            if (ordered && layer < max) ordered = false;
            if (layer < min) min = layer;
            if (layer > max) max = layer;
        }
        const span = max - min + 1;
        if (!Number.isSafeInteger(span) || span > 64) return false;
        if (ordered) return true;
        let indices = this.sortIndices;
        if (!indices || indices.length < count) {
            let capacity = indices?.length ?? 32768;
            while (capacity < count) capacity *= 2;
            indices = this.sortIndices = new Uint32Array(capacity);
        }
        const cursors = (this.layerCursors ??= new Uint32Array(64));
        cursors.fill(0, 0, span);
        for (let i = 0; i < count; i++) cursors[layers[i] - min]++;
        let offset = 0;
        for (let bucket = 0; bucket < span; bucket++) {
            const size = cursors[bucket];
            cursors[bucket] = offset;
            offset += size;
        }
        // Ascending source indices preserve insertion ties and adjacent texture runs.
        for (let i = 0; i < count; i++) indices[cursors[layers[i] - min]++] = i;
        for (let i = 0; i < count; i++) order[i] = indices[i];
        return true;
    }
    /** The checked prefix has one finite depth and nondecreasing layers. */
    private isDepthTailOrdered(start: number, scene: number, min: number, max: number): boolean {
        let previousLayer = this.layers[start - 1],
            previousDepth = this.depths[start - 1];
        for (let i = start; i < this.count; i++) {
            const layer = this.layers[i],
                depth = this.depths[i];
            if (
                this.order[i] !== i ||
                this.scenes[i] !== scene ||
                !Number.isSafeInteger(layer) ||
                !Number.isFinite(depth) ||
                layer < previousLayer ||
                (layer === previousLayer && depth < previousDepth)
            )
                return false;
            if (layer < min) min = layer;
            if (layer > max) max = layer;
            previousLayer = layer;
            previousDepth = depth;
        }
        const span = max - min + 1;
        return Number.isSafeInteger(span) && span <= 64;
    }
    /**
     * Writes a centered rectangle as translation plus column vectors. Kept separate so
     * Frame.add stays within V8's default inlining budget in hot authoring loops.
     *
     * Snapping rounds the translation corner, `round(x - hx)`, computed as
     * `round(x - frac(hx)) - floor(hx)`: exact integers, and identical to the former centre
     * rounding whenever the half extent `hx` is an integer (even unrotated sizes). The half
     * extent is first quantized to 2^-20 so quarter-turn trigonometric noise
     * (cos(π/2) ≈ 6e-17) cannot move half-pixel ties; multiples of 2^-20, integers
     * included, are unchanged.
     */
    private packAffine(o: number, x: number, y: number, w: number, h: number, angle: number) {
        const d = this.data;
        const c = Math.cos(angle),
            s = Math.sin(angle);
        const ix = c * w,
            iy = s * w,
            jx = -s * h,
            jy = c * h;
        const hx = (ix + jx) / 2,
            hy = (iy + jy) / 2;
        if (this.snap) {
            const qx = Math.round(hx * SNAP_GRID) / SNAP_GRID,
                qy = Math.round(hy * SNAP_GRID) / SNAP_GRID;
            const fx = Math.floor(qx),
                fy = Math.floor(qy);
            d[o] = Math.round(x - (qx - fx)) - fx;
            d[o + 1] = Math.round(y - (qy - fy)) - fy;
        } else {
            d[o] = x - hx;
            d[o + 1] = y - hy;
        }
        d[o + 2] = ix;
        d[o + 3] = iy;
        d[o + 4] = jx;
        d[o + 5] = jy;
    }
}
