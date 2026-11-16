import * as THREE from 'three';
import { fx } from './fx.js';
import { RINGS } from './config.js';
import { envelopes } from './shaders/common.js';

const gauss = () => {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const pointFrag = /* glsl */ `
varying float vA;
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float core = exp(-d * d * 55.0);
  float glow = exp(-d * 7.0) * 0.22;
  float a = (core + glow) * vA;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

// ---------------------------------------------------------------- Dust belts
const dustVert = /* glsl */ `
attribute vec4 aDust; // angle, radius offset, height, ring index
attribute vec4 aRand; // size, twinkle speed, phase, brightness
uniform float uTime;
uniform float uPixelRatio;
uniform float uDustIn;
uniform float uSpins[5];
uniform float uRadii[5];
uniform float uShockSpeed;
uniform vec2 uShockT;
uniform float uNova;
uniform float uMusic;
varying float vA;
varying vec3 vCol;
${envelopes}
void main() {
  int ri = int(aDust.w + 0.5);
  float R = uRadii[ri] + aDust.y;
  float a = aDust.x + uSpins[ri] + uTime * 0.012 * (aRand.y - 0.5);
  vec3 p = vec3(sin(a) * R, aDust.z, cos(a) * R);
  float arrive = R / uShockSpeed;
  float b = bounceEnv(uShockT.x - arrive) + bounceEnv(uShockT.y - arrive * 0.6);
  p.y += b * (0.25 + aRand.w * 0.7);
  p.xz *= 1.0 + uNova * 0.3 * aRand.w;
  p.y += uNova * aRand.w * 1.5;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float tw = 0.5 + 0.5 * sin(uTime * (1.0 + aRand.y * 5.0) + aRand.z * 6.2831);
  tw = tw * tw * tw;
  float reveal = clamp(uDustIn * 1.4 - aRand.z * 0.4, 0.0, 1.0);
  vA = aRand.w * (0.2 + 1.1 * tw) * (1.0 + b * 3.0 + uMusic * 1.6) * reveal * 0.6;
  vCol = mix(vec3(1.0, 0.9, 0.78), vec3(1.0, 0.62, 0.32), aRand.z);
  gl_PointSize = aRand.x * uPixelRatio * (190.0 / -mv.z) * (0.65 + tw * 0.6);
  gl_Position = projectionMatrix * mv;
}
`;

function makeDust(count, pixelRatio) {
  const aDust = new Float32Array(count * 4);
  const aRand = new Float32Array(count * 4);
  const weights = RINGS.map((r) => r.r);
  const total = weights.reduce((a, b) => a + b, 0);
  const clumps = RINGS.map(() => [0, 1, 2].map(() => Math.random() * Math.PI * 2));
  for (let i = 0; i < count; i++) {
    let pick = Math.random() * total;
    let ri = 0;
    while (pick > weights[ri]) pick -= weights[ri++];
    const clustered = Math.random() < 0.45;
    const angle = clustered
      ? clumps[ri][Math.floor(Math.random() * 3)] + gauss() * 0.32
      : Math.random() * Math.PI * 2;
    const floating = Math.random() < 0.1;
    aDust.set([angle, gauss() * 0.2, floating ? 0.25 + Math.random() * 1.1 : Math.abs(gauss()) * 0.1 + 0.02, ri], i * 4);
    const bright = Math.random();
    aRand.set([0.6 + Math.pow(Math.random(), 3) * 2.6, Math.random(), Math.random(), 0.25 + bright * bright * 0.95], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aDust', new THREE.BufferAttribute(aDust, 4));
  geo.setAttribute('aRand', new THREE.BufferAttribute(aRand, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: fx.u.uTime,
      uPixelRatio: pixelRatio,
      uDustIn: fx.u.uDustIn,
      uSpins: fx.u.uSpins,
      uRadii: { value: RINGS.map((r) => r.r) },
      uShockSpeed: fx.u.uShockSpeed,
      uShockT: fx.u.uShockT,
      uNova: fx.u.uNova,
      uMusic: fx.u.uMusic,
    },
    vertexShader: dustVert,
    fragmentShader: pointFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  return pts;
}

// ---------------------------------------------------------------- Sun embers
const emberVert = /* glsl */ `
attribute vec4 aSeed; // theta, speed, phase, size
uniform float uTime;
uniform float uPixelRatio;
uniform float uIgnite;
uniform float uPulse;
uniform vec3 uSunPos;
varying float vA;
varying vec3 vCol;
void main() {
  float life = fract(uTime * aSeed.y + aSeed.z);
  float th = aSeed.x;
  float el = fract(aSeed.z * 13.17) * 1.3 - 0.15;  // elevation on the sun
  vec3 dir = normalize(vec3(cos(th) * cos(el), sin(el) + 0.2, sin(th) * cos(el) * 0.7 + 0.25));
  vec3 p = uSunPos + dir * 2.8 * uIgnite;
  p += dir * life * (1.0 + aSeed.w * 2.0);
  p.y += life * life * 4.2;
  p.x += sin(life * 7.0 + aSeed.z * 30.0) * 0.35 * life;
  p.z += cos(life * 5.0 + aSeed.z * 17.0) * 0.3 * life;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float fade = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.55, 1.0, life));
  vA = fade * uIgnite * (0.75 + uPulse * 1.5);
  vCol = mix(vec3(2.0, 1.3, 0.55), vec3(1.3, 0.16, 0.03), smoothstep(0.0, 0.6, life));
  gl_PointSize = (0.6 + aSeed.w * 1.8) * (1.0 - life * 0.6) * uPixelRatio * (170.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

function makeEmbers(count, pixelRatio) {
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    seed.set([Math.random() * Math.PI * 2, 0.07 + Math.random() * 0.16, Math.random(), Math.random()], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const pts = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: fx.u.uTime,
        uPixelRatio: pixelRatio,
        uIgnite: fx.u.uSunIgnite,
        uPulse: fx.u.uSunPulse,
        uSunPos: fx.u.uSunPos,
      },
      vertexShader: emberVert,
      fragmentShader: pointFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  return pts;
}

// ---------------------------------------------------------------- Sparks (CPU)
const sparkVert = /* glsl */ `
attribute vec3 aCol;
attribute float aSize;
attribute float aAlpha;
uniform float uPixelRatio;
varying float vA;
varying vec3 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vA = aAlpha;
  vCol = aCol;
  gl_PointSize = aSize * uPixelRatio * (240.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

class Sparks {
  constructor(max, pixelRatio) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.head = 0;
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aCol', this.aCol);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aAlpha', this.aAlpha);
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uPixelRatio: pixelRatio },
        vertexShader: sparkVert,
        fragmentShader: pointFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /**
   * @param {THREE.Vector3} origin
   * @param {number} n
   * @param {{spread?:number, speed?:number, up?:number, hot?:boolean, radial?:THREE.Vector3}} o
   */
  emit(origin, n, o = {}) {
    const spread = o.spread ?? 0.3;
    const speed = o.speed ?? 3;
    const up = o.up ?? 3;
    for (let k = 0; k < n; k++) {
      const i = this.head;
      this.head = (this.head + 1) % this.max;
      const i3 = i * 3;
      this.pos[i3] = origin.x + (Math.random() - 0.5) * spread;
      this.pos[i3 + 1] = origin.y + Math.random() * spread * 0.6;
      this.pos[i3 + 2] = origin.z + (Math.random() - 0.5) * spread;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random());
      let vx = Math.cos(a) * s;
      let vz = Math.sin(a) * s;
      if (o.radial) {
        vx = vx * 0.5 + o.radial.x * s;
        vz = vz * 0.5 + o.radial.z * s;
      }
      this.vel[i3] = vx;
      this.vel[i3 + 1] = up * (0.4 + Math.random());
      this.vel[i3 + 2] = vz;
      const hot = o.hot || Math.random() < 0.3;
      this.col[i3] = hot ? 2.6 : 2.2;
      this.col[i3 + 1] = hot ? 1.5 : 0.55;
      this.col[i3 + 2] = hot ? 0.6 : 0.1;
      this.size[i] = 0.6 + Math.random() * 1.6;
      this.life[i] = 0;
      this.maxLife[i] = 0.5 + Math.random() * 1.1;
      this.alpha[i] = 1;
    }
  }

  update(dt) {
    const g = -7.5;
    for (let i = 0; i < this.max; i++) {
      if (this.alpha[i] <= 0) continue;
      this.life[i] += dt;
      const t = this.life[i] / this.maxLife[i];
      if (t >= 1) {
        this.alpha[i] = 0;
        continue;
      }
      const i3 = i * 3;
      this.vel[i3 + 1] += g * dt;
      const drag = Math.exp(-dt * 1.6);
      this.vel[i3] *= drag;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.02) {
        // skitter along the wet floor
        this.pos[i3 + 1] = 0.02;
        this.vel[i3 + 1] *= -0.35;
      }
      this.alpha[i] = (1 - t) * (1 - t);
      // cool from yellow-white to deep red
      this.col[i3 + 1] *= 1 - dt * 1.6;
      this.col[i3 + 2] *= 1 - dt * 2.5;
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- Shooting stars
const streakFrag = /* glsl */ `
uniform float uA;
varying vec2 vUv;
void main() {
  float along = vUv.x;
  float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
  float a = pow(along, 2.5) * pow(across, 3.0) * uA;
  a += exp(-pow((1.0 - along) * 40.0, 2.0)) * across * uA * 2.0;
  gl_FragColor = vec4(vec3(1.6, 1.3, 1.1) * a, 1.0);
}
`;

class ShootingStars {
  constructor() {
    this.group = new THREE.Group();
    this.stars = [];
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uA: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: streakFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      m.renderOrder = -1;
      m.visible = false;
      this.group.add(m);
      this.stars.push({ m, mat, t: 0, dur: 1, next: 2 + Math.random() * 4 + i * 3, x: 0, y: 0, dx: 0, dy: 0 });
    }
  }

  update(dt, camera) {
    // Lives in a camera-facing plane far behind the scene.
    this.group.position.copy(camera.position).add(new THREE.Vector3(0, 0, -60).applyQuaternion(camera.quaternion));
    this.group.quaternion.copy(camera.quaternion);
    for (const s of this.stars) {
      if (!s.m.visible) {
        s.next -= dt;
        if (s.next <= 0) {
          s.m.visible = true;
          s.t = 0;
          s.dur = 0.7 + Math.random() * 0.6;
          const dir = Math.random() < 0.5 ? -1 : 1;
          s.x = (Math.random() - 0.5) * 50;
          s.y = 6 + Math.random() * 14;
          const ang = (-0.35 - Math.random() * 0.35) * (dir > 0 ? 1 : -1) + (dir > 0 ? 0 : Math.PI);
          s.dx = Math.cos(ang);
          s.dy = Math.sin(ang);
          s.m.rotation.z = ang;
          s.m.scale.set(9 + Math.random() * 6, 0.09, 1);
        }
        continue;
      }
      s.t += dt;
      const k = s.t / s.dur;
      if (k >= 1) {
        s.m.visible = false;
        s.next = 3 + Math.random() * 6;
        continue;
      }
      const dist = k * 38;
      s.m.position.set(s.x + s.dx * dist, s.y + s.dy * dist, 0);
      s.mat.uniforms.uA.value = Math.sin(k * Math.PI) * 1.2;
    }
  }
}

// ---------------------------------------------------------------- Facade
export class Particles {
  constructor(quality, pixelRatio) {
    const hq = quality === 'high';
    this.group = new THREE.Group();
    this.dust = makeDust(hq ? 7500 : 2600, pixelRatio);
    this.embers = makeEmbers(hq ? 380 : 180, pixelRatio);
    this.sparks = new Sparks(hq ? 1400 : 600, pixelRatio);
    this.shooting = new ShootingStars();
    this.group.add(this.dust, this.embers, this.sparks.points, this.shooting.group);
  }

  update(dt, camera) {
    this.sparks.update(dt);
    this.shooting.update(dt, camera);
  }
}
