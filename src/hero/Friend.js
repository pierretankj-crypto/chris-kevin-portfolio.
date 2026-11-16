import * as THREE from 'three';
import { fx } from './fx.js';
import { simplex3 } from './shaders/common.js';

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Shared masking: fade into the floor at the bottom, trim the photo's side edges.
const maskFn = /* glsl */ `
float photoMask(vec2 uv) {
  // oval bust: the shoulders melt away toward the bottom corners
  float corner = smoothstep(0.6, 0.4, abs(uv.x - 0.5) + max(0.0, 0.45 - uv.y) * 0.95);
  return corner * smoothstep(0.03, 0.3, uv.y) * smoothstep(0.0, 0.012, uv.x) * smoothstep(1.0, 0.985, uv.x) * smoothstep(1.0, 0.99, uv.y);
}
`;

const depthFrag = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
${maskFn}
void main() {
  // only the fully-opaque body writes depth; the faded bottom must let the floor through
  float m = photoMask(vUv);
  if (texture2D(uMap, vUv).a < 0.5 || m < 0.985) discard;
  gl_FragColor = vec4(0.0);
}
`;

const colorFrag = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uTexel;
uniform float uTime;
uniform float uIn;
uniform float uPulse;
varying vec2 vUv;
${simplex3}
${maskFn}

float A(vec2 uv) { return texture2D(uMap, uv).a; }

void main() {
  vec2 uv = vUv;
  vec4 tex = texture2D(uMap, uv);
  float m = photoMask(uv);
  float a = tex.a * m;

  // heat-haze offset for the outer glow
  vec2 haze = vec2(
    snoise(vec3(uv * vec2(5.0, 9.0), uTime * 0.9)),
    snoise(vec3(uv * vec2(5.0, 9.0) + 7.3, uTime * 0.9))
  ) * 0.006;

  float inner = 0.0;
  float outer = 0.0;
  for (int i = 0; i < 12; i++) {
    float ang = float(i) / 12.0 * 6.2831853;
    vec2 d = vec2(cos(ang), sin(ang));
    inner += A(uv + d * uTexel * 4.0);
    outer += A(uv + haze + d * uTexel * 20.0);
  }
  inner /= 12.0;
  outer /= 12.0;

  float rimW = mix(0.35, 1.0, smoothstep(0.35, 0.85, uv.y));
  float rim = a * clamp((1.0 - inner) * 2.4, 0.0, 1.0) * rimW;
  float halo = (1.0 - tex.a) * outer * m * rimW;

  // Grade the flat-lit photo so it sits in a sun-backlit scene.
  vec3 col = tex.rgb;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, 0.88);
  col *= vec3(1.0, 0.88, 0.8) * 0.82;
  col = mix(col * vec3(0.72, 0.68, 1.0), col, smoothstep(0.0, 0.25, l)); // cool shadows

  // Dissolve-in: burns upward from the floor with a glowing edge.
  float n = snoise(vec3(uv * vec2(6.0, 8.0), 3.0)) * 0.5 + 0.5;
  float d = uv.y * 0.65 + n * 0.35;
  float k = uIn * 1.3;
  float vis = 1.0 - smoothstep(k - 0.06, k, d);
  float burn = smoothstep(k - 0.16, k - 0.05, d) * vis * (1.0 - smoothstep(0.92, 1.0, uIn));
  float body = vis; // before the body appears it reads as a rim-lit silhouette

  float pulse = 1.0 + uPulse * 1.4;
  vec3 rimCol = vec3(3.2, 1.25, 0.32) * pulse;
  vec3 haloCol = vec3(1.5, 0.45, 0.08) * pulse;

  float silhouetteRim = smoothstep(0.0, 0.25, uIn);
  vec3 outc = col * a * body
            + rimCol * rim * silhouetteRim
            + haloCol * halo * 0.9 * silhouetteRim
            + vec3(3.5, 1.2, 0.25) * burn * a;
  gl_FragColor = vec4(outc, a * body);
}
`;

const glintFrag = /* glsl */ `
uniform float uI;
uniform float uRot;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float c = cos(uRot), s = sin(uRot);
  p = mat2(c, -s, s, c) * p;
  float r = length(p);
  float core = exp(-r * 10.0) * 2.0;
  float sx = exp(-abs(p.y) * 70.0) * exp(-abs(p.x) * 2.6);
  float sy = exp(-abs(p.x) * 70.0) * exp(-abs(p.y) * 3.4);
  vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p;
  float d1 = exp(-abs(q.y) * 90.0) * exp(-abs(q.x) * 7.0) * 0.45;
  float d2 = exp(-abs(q.x) * 90.0) * exp(-abs(q.y) * 7.0) * 0.45;
  float v = (core + sx + sy + d1 + d2) * uI * smoothstep(1.0, 0.7, r);
  gl_FragColor = vec4(vec3(2.4, 2.0, 1.55) * v, 1.0);
}
`;

export class Friend {
  constructor(texture) {
    const img = texture.image;
    this.height = 5.7;
    this.width = this.height * (img.width / img.height);

    this.group = new THREE.Group();
    this.group.position.set(0, 0, 0.35);

    const geo = new THREE.PlaneGeometry(this.width, this.height);
    const yOff = this.height / 2 - 0.55;

    // Depth-only prepass so particles behind the body are hidden and the sun
    // reads as a black silhouette before the reveal.
    this.depthMesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: texture } },
        vertexShader: vert,
        fragmentShader: depthFrag,
        colorWrite: false,
      }),
    );
    this.depthMesh.position.y = yOff;
    // must draw before the sun so the body masks it (opaques sort by material id otherwise)
    this.depthMesh.renderOrder = -5;
    this.group.add(this.depthMesh);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uTexel: { value: new THREE.Vector2(1 / img.width, 1 / img.height) },
        uTime: fx.u.uTime,
        uIn: fx.u.uFriendIn,
        uPulse: fx.u.uSunPulse,
      },
      vertexShader: vert,
      fragmentShader: colorFrag,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.y = yOff;
    this.mesh.renderOrder = 3;
    this.group.add(this.mesh);

    // Lens glints on the glasses (positions in photo UV space).
    this.glints = [];
    const spots = [
      { u: 0.345, v: 0.758, size: 1.1 },
      { u: 0.205, v: 0.742, size: 0.7 },
    ];
    for (const s of spots) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uI: { value: 0 }, uRot: { value: 0 } },
        vertexShader: vert,
        fragmentShader: glintFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s.size, s.size), mat);
      m.position.set((s.u - 0.5) * this.width, (s.v - 0.5) * this.height + yOff, 0.06);
      m.renderOrder = 6;
      this.group.add(m);
      this.glints.push({ mesh: m, mat, t: 99, delay: this.glints.length * 0.12 });
    }
    this.nextIdleGlint = 6;
  }

  glint() {
    for (const g of this.glints) g.t = -g.delay;
  }

  update(dt, camera) {
    // billboard toward the camera: full yaw, and lean back part-way so the
    // photo isn't foreshortened when the camera looks down on the orbit
    const p = this.group.position;
    const dx = camera.position.x - p.x;
    const dz = camera.position.z - p.z;
    this.group.rotation.order = 'YXZ';
    this.group.rotation.y = Math.atan2(dx, dz);
    const pitch = Math.atan2(camera.position.y - this.height * 0.45, Math.hypot(dx, dz));
    this.group.rotation.x = -pitch * 0.6;
    // gentle float
    const t = fx.u.uTime.value;
    this.group.position.y = Math.sin(t * 0.9) * 0.05;

    if (fx.u.uFriendIn.value > 0.95) {
      this.nextIdleGlint -= dt;
      if (this.nextIdleGlint <= 0) {
        this.glint();
        this.nextIdleGlint = 5 + Math.random() * 5;
      }
    }
    for (const g of this.glints) {
      g.t += dt;
      const k = g.t < 0 ? 0 : g.t < 0.12 ? g.t / 0.12 : Math.exp(-(g.t - 0.12) * 4.5);
      g.mat.uniforms.uI.value = k * fx.u.uFriendIn.value;
      g.mat.uniforms.uRot.value = 0.3 + Math.max(0, g.t) * 0.9;
    }
  }
}
