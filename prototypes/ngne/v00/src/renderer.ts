import { Camera } from "./primitives.js";
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
const STRIDE = 13;
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
    this.order.length = 0;
    this.textures.length = 0;
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
    this.add(
      x,
      y,
      width,
      height,
      color,
      alpha,
      layer,
      0,
      undefined,
      0,
      0,
      1,
      1,
      0,
      screen,
    );
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
    if (o + STRIDE > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    if (!screen) {
      x -= this.camera.x;
      y -= this.camera.y;
    }
    if (this.snap) {
      x = Math.round(x);
      y = Math.round(y);
    }
    const d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = w;
    d[o + 3] = h;
    d[o + 4] = u;
    d[o + 5] = v;
    d[o + 6] = uw;
    d[o + 7] = vh;
    d[o + 8] = ((color >>> 16) & 255) / 255;
    d[o + 9] = ((color >>> 8) & 255) / 255;
    d[o + 10] = (color & 255) / 255;
    d[o + 11] = alpha;
    d[o + 12] = angle;
    this.textures[i] = texture;
    this.scenes[i] = this.sceneIndex;
    this.layers[i] = layer;
    this.depths[i] = depth;
    this.order[i] = i;
  }
  sort() {
    this.order.sort(
      (a, b) =>
        this.scenes[a] - this.scenes[b] ||
        this.layers[a] - this.layers[b] ||
        this.depths[a] - this.depths[b] ||
        a - b,
    );
  }
}
const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec4 rect;
layout(location=1) in vec4 uvRect;
layout(location=2) in vec4 color;
layout(location=3) in float angle;
uniform vec2 resolution;
out vec2 uv; out vec4 tint;
const vec2 corners[6]=vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));
void main(){ vec2 c=corners[gl_VertexID]; vec2 p=(c-.5)*rect.zw;
 p=mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*p+rect.xy;
 gl_Position=vec4(p/resolution*vec2(2,-2)+vec2(-1,1),0,1); uv=uvRect.xy+c*uvRect.zw; tint=color; }`;
const fragment = `#version 300 es
precision mediump float;
in vec2 uv; in vec4 tint; uniform sampler2D atlas; out vec4 outputColor;
void main(){ outputColor=texture(atlas,uv)*tint; }`;
export class Renderer {
  private gl: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private buffer!: WebGLBuffer;
  private vao!: WebGLVertexArrayObject;
  private textures = new Map<string, WebGLTexture>();
  private sources = new Map<string, TexImageSource>();
  private upload = new Float32Array(STRIDE * 2048);
  private gpuBytes = 0;
  private lost = false;
  private disposed = false;
  drawCalls = 0;
  sprites = 0;
  private lose = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };
  private restore = () => {
    this.lost = false;
    this.textures.clear();
    this.gpuBytes = 0;
    try {
      this.initialize();
      for (const [id, source] of this.sources) this.uploadTexture(id, source);
    } catch (e) {
      this.lost = true;
      this.onError(e);
    }
  };
  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly width: number,
    readonly height: number,
    private onError: (error: unknown) => void = console.error,
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl)
      throw new Error(
        "NGNE requires WebGL 2. Enable browser hardware acceleration.",
      );
    this.gl = gl;
    canvas.width = width;
    canvas.height = height;
    try {
      this.initialize();
    } catch (e) {
      this.dispose();
      throw e;
    }
    canvas.addEventListener("webglcontextlost", this.lose);
    canvas.addEventListener("webglcontextrestored", this.restore);
  }
  private initialize() {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(error ?? "Shader compile failed");
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vertex),
      fs = compile(gl.FRAGMENT_SHADER, fragment);
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      throw new Error(
        gl.getProgramInfoLog(this.program) ?? "Program link failed",
      );
    this.buffer = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(
        i,
        i === 3 ? 1 : 4,
        gl.FLOAT,
        false,
        STRIDE * 4,
        i * 16,
      );
      gl.vertexAttribDivisor(i, 1);
    }
    const white = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, white);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    this.parameters();
    this.textures.set("", white);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  private parameters() {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  texture(id: string, source: TexImageSource) {
    if (this.disposed) throw new Error("Renderer is disposed");
    if (!id) throw new Error("Texture ID required");
    this.sources.set(id, source);
    if (!this.lost) this.uploadTexture(id, source);
  }
  private uploadTexture(id: string, source: TexImageSource) {
    const gl = this.gl;
    const old = this.textures.get(id);
    if (old) gl.deleteTexture(old);
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.parameters();
    this.textures.set(id, texture);
  }
  render(frame: Frame, clear = 0x090e20) {
    this.drawCalls = 0;
    this.sprites = frame.count;
    if (this.lost || this.disposed) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(
      ((clear >> 16) & 255) / 255,
      ((clear >> 8) & 255) / 255,
      (clear & 255) / 255,
      1,
    );
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!frame.count) return;
    frame.sort();
    if (this.upload.length < frame.count * STRIDE)
      this.upload = new Float32Array(frame.data.length);
    frame.order.forEach((source, target) =>
      this.upload.set(
        frame.data.subarray(source * STRIDE, (source + 1) * STRIDE),
        target * STRIDE,
      ),
    );
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if (this.gpuBytes < this.upload.byteLength) {
      gl.bufferData(gl.ARRAY_BUFFER, this.upload.byteLength, gl.DYNAMIC_DRAW);
      this.gpuBytes = this.upload.byteLength;
    }
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.upload.subarray(0, frame.count * STRIDE),
    );
    gl.uniform2f(
      gl.getUniformLocation(this.program, "resolution"),
      this.width,
      this.height,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(gl.getUniformLocation(this.program, "atlas"), 0);
    let start = 0;
    while (start < frame.count) {
      const texture = frame.textures[frame.order[start]] ?? "";
      let end = start + 1;
      while (
        end < frame.count &&
        (frame.textures[frame.order[end]] ?? "") === texture
      )
        end++;
      const handle = this.textures.get(texture);
      if (!handle) throw new Error("Texture is not uploaded: " + texture);
      gl.bindTexture(gl.TEXTURE_2D, handle);
      for (let i = 0; i < 4; i++)
        gl.vertexAttribPointer(
          i,
          i === 3 ? 1 : 4,
          gl.FLOAT,
          false,
          STRIDE * 4,
          start * STRIDE * 4 + i * 16,
        );
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, end - start);
      this.drawCalls++;
      start = end;
    }
  }
  dispose() {
    this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.lose);
    this.canvas.removeEventListener("webglcontextrestored", this.restore);
    const gl = this.gl;
    for (const t of this.textures.values()) gl.deleteTexture(t);
    this.textures.clear();
    this.sources.clear();
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}
