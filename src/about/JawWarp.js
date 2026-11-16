/**
 * Tiny WebGL2 "liquify" for the About photo: drops the jaw by stretching the
 * mouth opening and pushing the chin down, synced to each syllable.
 */
const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vUv = vec2((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5); // y-down, like the image
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uMouth;
uniform float uJaw;
uniform float uAspect;
in vec2 vUv;
out vec4 o;
void main() {
  vec2 uv = vUv;
  vec2 d = (uv - uMouth) * vec2(uAspect, 1.0);
  // only the area from the middle of the mouth downwards moves
  float below = smoothstep(-0.01, 0.01, uv.y - uMouth.y);
  float r = length(d * vec2(1.0, 0.75));
  float w = below * (1.0 - smoothstep(0.03, 0.2, r));
  uv.y -= uJaw * 0.028 * w;
  uv.x -= (uv.x - uMouth.x) * uJaw * 0.05 * w; // corners widen a touch
  vec4 c = texture(uTex, uv);
  // shadow in the opening as it widens
  vec2 m = (vUv - uMouth - vec2(0.0, 0.006)) * vec2(uAspect * 0.95, 2.6);
  float inside = exp(-dot(m, m) / (0.045 * 0.045));
  c.rgb *= 1.0 - inside * uJaw * 0.5;
  o = c;
}`;

export async function createJawWarp(canvas, img, mouth) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  gl.bindVertexArray(gl.createVertexArray());

  if (!img.complete) await img.decode().catch(() => {});
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const loc = {
    mouth: gl.getUniformLocation(prog, 'uMouth'),
    jaw: gl.getUniformLocation(prog, 'uJaw'),
    aspect: gl.getUniformLocation(prog, 'uAspect'),
  };
  gl.uniform2f(loc.mouth, mouth.u, mouth.v);
  gl.clearColor(0, 0, 0, 0);

  let jaw = 0;
  let queued = false;
  const draw = () => {
    queued = false;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(loc.jaw, jaw);
    gl.uniform1f(loc.aspect, canvas.width / canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const request = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(draw);
    }
  };
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    request();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  return {
    get jaw() {
      return jaw;
    },
    set jaw(v) {
      jaw = v;
      request();
    },
  };
}
