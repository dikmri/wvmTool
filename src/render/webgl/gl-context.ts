import { createProgram, VERTEX_SHADER_SRC, FRAGMENT_SHADER_SRC } from './mosaic-shader';
import type { MosaicTrack, InterpolatedRect } from '../../engine/types';
import { getTrackRectsAtTime } from '../../engine/keyframe-interpolator';

export class WebGL2MosaicRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private texture: WebGLTexture | null = null;
  private width = 0;
  private height = 0;

  constructor(canvas: OffscreenCanvas | HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
  }

  async init(width: number, height: number): Promise<void> {
    this.width = width;
    this.height = height;
    const gl = this.gl;

    gl.viewport(0, 0, width, height);

    this.program = createProgram(gl, VERTEX_SHADER_SRC, FRAGMENT_SHADER_SRC);

    // Full-screen quad
    const positions = new Float32Array([
      -1, -1, 0, 1,
       1, -1, 1, 1,
      -1,  1, 0, 0,
       1,  1, 1, 0,
    ]);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(this.program, 'a_position');
    const texLoc = gl.getAttribLocation(this.program, 'a_texCoord');

    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);

    gl.bindVertexArray(null);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  renderFrame(
    input: VideoFrame | ImageBitmap | HTMLVideoElement,
    tracks: MosaicTrack[],
    time: number,
  ): void {
    const gl = this.gl;
    if (!this.program || !this.vao || !this.texture) return;

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (input instanceof HTMLVideoElement) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, input);
    } else if (input instanceof ImageBitmap) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, input);
    } else {
      // VideoFrame
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, input as unknown as TexImageSource);
    }

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_texture'), 0);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_resolution'), this.width, this.height);

    const trackRects = getTrackRectsAtTime(tracks, time);
    const MAX = 8;
    const count = Math.min(trackRects.length, MAX);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_mosaicCount'), count);

    const rectData = new Float32Array(MAX * 4);
    const sizeData = new Float32Array(MAX);
    const rotData = new Float32Array(MAX);

    for (let i = 0; i < count; i++) {
      const { track, rect } = trackRects[i];
      const nx = rect.x / this.width;
      const ny = rect.y / this.height;
      const nw = rect.width / this.width;
      const nh = rect.height / this.height;
      rectData[i * 4 + 0] = nx;
      rectData[i * 4 + 1] = ny;
      rectData[i * 4 + 2] = nw;
      rectData[i * 4 + 3] = nh;
      sizeData[i] = track.mosaicSize;
      rotData[i] = (rect.rotation ?? 0) * Math.PI / 180;
    }

    gl.uniform4fv(gl.getUniformLocation(this.program, 'u_mosaicRects'), rectData);
    gl.uniform1fv(gl.getUniformLocation(this.program, 'u_mosaicSizes'), sizeData);
    gl.uniform1fv(gl.getUniformLocation(this.program, 'u_mosaicRotations'), rotData);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  async readPixels(): Promise<ImageBitmap> {
    const gl = this.gl;
    const pixels = new Uint8ClampedArray(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // WebGL y-axis is flipped
    const flipped = flipVertical(pixels, this.width, this.height);
    const imageData = new ImageData(flipped, this.width, this.height);
    return createImageBitmap(imageData);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.program) gl.deleteProgram(this.program);
  }
}

function flipVertical(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * rowBytes;
    const dst = y * rowBytes;
    out.set(pixels.subarray(src, src + rowBytes), dst);
  }
  return out;
}
