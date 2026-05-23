export const VERTEX_SHADER_SRC = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

// Mosaic shader: pixelates specified rectangular regions (supports rotation)
export const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 outColor;

uniform sampler2D u_texture;
uniform vec2 u_resolution;

// Up to 8 mosaic regions
uniform int u_mosaicCount;
uniform vec4 u_mosaicRects[8];      // x, y, width, height in normalized coords (0..1)
uniform float u_mosaicSizes[8];     // pixel block size for each region
uniform float u_mosaicRotations[8]; // rotation in radians

void main() {
  vec2 uv = v_texCoord;
  vec4 color = texture(u_texture, uv);

  for (int i = 0; i < 8; i++) {
    if (i >= u_mosaicCount) break;
    vec4 rect = u_mosaicRects[i];
    float blockSize = u_mosaicSizes[i];
    float angle = u_mosaicRotations[i];

    float cx = rect.x + rect.z * 0.5;
    float cy = rect.y + rect.w * 0.5;
    float hw = rect.z * 0.5;
    float hh = rect.w * 0.5;

    // Rotate UV into rect-local frame (inverse rotation)
    float cosA = cos(angle);
    float sinA = sin(angle);
    float dx = uv.x - cx;
    float dy = uv.y - cy;
    float localX = dx * cosA + dy * sinA;
    float localY = -dx * sinA + dy * cosA;

    if (abs(localX) <= hw && abs(localY) <= hh) {
      // Pixelate by snapping to block grid in screen space
      float bx = blockSize / u_resolution.x;
      float by = blockSize / u_resolution.y;
      float snappedU = floor(uv.x / bx) * bx + bx * 0.5;
      float snappedV = floor(uv.y / by) * by + by * 0.5;
      color = texture(u_texture, vec2(snappedU, snappedV));
    }
  }

  outColor = color;
}
`;

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${info}`);
  }
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  return program;
}
