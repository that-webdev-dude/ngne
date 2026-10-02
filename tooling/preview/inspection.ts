/** Presentation-only center offset, in baseline CSS pixels. Every canvas point can
 * reach the viewport center; clamping prevents losing the canvas beyond an edge. */
export class Inspection {
    x = 0;
    y = 0;
    zoom = 1;
    constructor(
        readonly width: number,
        readonly height: number,
    ) {}
    pan(dx: number, dy: number) {
        this.x = Math.max(-this.width / 2, Math.min(this.width / 2, this.x + dx / this.zoom));
        this.y = Math.max(-this.height / 2, Math.min(this.height / 2, this.y + dy / this.zoom));
    }
    reset() {
        this.zoom = 1;
        this.x = this.y = 0;
    }
}
