import * as THREE from 'three';
import { fx } from './fx.js';
import { simplex3 } from './shaders/common.js';

const sunVert = /* glsl */ `
varying vec3 vObj;
varying vec3 vNw;
varying vec3 vWp;
void main() {
  vObj = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  vNw = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const sunFrag = /* glsl */ `
uniform float uTime;
uniform float uIgnite;
uniform float uPulse;
varying vec3 vObj;
varying vec3 vNw;
varying vec3 vWp;
${simplex3}

vec3 sunRamp(float h) {
  vec3 c0 = vec3(0.14, 0.008, 0.0);
  vec3 c1 = vec3(0.95, 0.12, 0.008);
  vec3 c2 = vec3(1.75, 0.6, 0.05);
  vec3 c3 = vec3(2.3, 1.55, 0.5);
  h = clamp(h, 0.0, 1.0);
  vec3 c = mix(c0, c1, smoothstep(0.0, 0.38, h));
  c = mix(c, c2, smoothstep(0.32, 0.68, h));
  c = mix(c, c3, smoothstep(0.72, 1.0, h));
  return c;
}

void main() {
  vec3 p = normalize(vObj);
  float t = uTime * 0.06;
  float cr = cos(t * 0.6), sr = sin(t * 0.6);
  p.xz = mat2(cr, -sr, sr, cr) * p.xz;

  // Domain-warped plasma
  vec3 q = p * 2.0;
  float w1 = snoise(q + vec3(0.0, t, 0.0));
  float w2 = snoise(q * 1.7 - vec3(t * 0.7, 0.0, t));
  vec3 wp = p * 3.2 + vec3(w1, w2, w1 * w2) * 0.7;
  float n = fbm5(wp + vec3(t * 0.5));

  // Granulation and dark filaments
  float cells = snoise(p * 16.0 + vec3(t * 2.5)) * 0.5 + snoise(p * 34.0 - vec3(t * 3.5)) * 0.25;
  float fil = smoothstep(0.32, 0.0, abs(snoise(p * 4.5 + vec3(t * 0.8, 0.0, -t))));

  float heat = 0.56 + 0.42 * n + 0.1 * cells - fil * 0.2;

  vec3 V = normalize(cameraPosition - vWp);
  float mu = clamp(dot(normalize(vNw), V), 0.0, 1.0);
  heat *= mix(0.5, 1.0, pow(mu, 0.5)); // limb darkening

  vec3 col = sunRamp(heat);
  col += vec3(1.6, 0.42, 0.05) * pow(1.0 - mu, 2.5) * 0.9; // hot limb
  col *= 1.0 + uPulse * 0.8;
  // while igniting the sun is a white-hot point
  col = mix(vec3(6.0, 4.5, 2.5), col, smoothstep(0.08, 0.6, uIgnite));
  gl_FragColor = vec4(col, 1.0);
}
`;

const billboardVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const coronaFrag = /* glsl */ `
uniform float uTime;
uniform float uIgnite;
uniform float uPulse;
uniform float uR0;
varying vec2 vUv;
${simplex3}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float d = max(r - uR0, 0.0);
  vec2 cs = vec2(cos(a), sin(a));

  float glow = exp(-d * 9.0) * 0.85 + exp(-d * 3.2) * 0.14;
  float s1 = snoise(vec3(cs * 1.6, uTime * 0.12)) * 0.5 + 0.5;
  float s2 = snoise(vec3(cs * 5.0, uTime * 0.25 - d * 2.5)) * 0.5 + 0.5;
  float s3 = snoise(vec3(cs * 11.0, uTime * 0.4 - d * 4.0)) * 0.5 + 0.5;
  // pow() of a negative base is undefined on some GPUs (NaN), so clamp first
  s1 = clamp(s1, 0.0, 1.0); s2 = clamp(s2, 0.0, 1.0); s3 = clamp(s3, 0.0, 1.0);
  float rays = pow(s1, 3.0) * exp(-d * 3.2) * 1.2 + pow(s2, 4.0) * exp(-d * 4.5) + pow(s3, 6.0) * exp(-d * 6.0) * 0.8;

  vec3 col = vec3(1.25, 0.4, 0.06) * glow + vec3(1.3, 0.55, 0.15) * rays * 0.55;
  col *= 1.0 + uPulse * 1.2;
  col *= smoothstep(1.0, 0.55, r);
  col *= uIgnite;
  gl_FragColor = vec4(col, 1.0);
}
`;

const flareVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const flareFrag = /* glsl */ `
uniform float uTime;
uniform float uLife;
uniform float uSeed;
uniform float uIgnite;
uniform float uHot;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
${simplex3}
void main() {
  float along = vUv.x;
  float core = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
  float flow = snoise(vec3(along * 9.0 - uTime * 1.4, uSeed * 7.0, uTime * 0.3)) * 0.5 + 0.5;
  float knots = pow(clamp(snoise(vec3(along * 22.0 - uTime * 2.2, uSeed, 1.0)) * 0.5 + 0.5, 0.0, 1.0), 3.0);
  float life = sin(clamp(uLife, 0.0, 1.0) * 3.14159265);
  // plasma drains from the apex near end-of-life
  float drain = smoothstep(0.55, 1.0, uLife) * smoothstep(0.25, 0.5, abs(along - 0.5)) ;
  vec3 col = mix(vec3(1.1, 0.08, 0.012), vec3(2.0, 0.6, 0.08), clamp(flow * 0.7 + knots, 0.0, 1.0));
  col *= 1.0 + uHot * 1.2;
  float a = core * (0.3 + flow * 0.7 + knots) * life * (1.0 - drain * 0.6) * 0.8;
  gl_FragColor = vec4(col * a * uIgnite, 1.0);
}
`;

export class Sun {
  constructor(quality) {
    this.radius = 2.8;
    this.group = new THREE.Group();
    this.group.position.copy(fx.u.uSunPos.value);

    const seg = quality === 'high' ? 96 : 56;
    this.sphere = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, seg, Math.round(seg * 0.66)),
      new THREE.ShaderMaterial({
        uniforms: { uTime: fx.u.uTime, uIgnite: fx.u.uSunIgnite, uPulse: fx.u.uSunPulse },
        vertexShader: sunVert,
        fragmentShader: sunFrag,
      }),
    );
    this.group.add(this.sphere);

    // Everything that should face the camera lives in this group.
    this.billboard = new THREE.Group();
    this.group.add(this.billboard);

    const coronaSize = this.radius * 5.4;
    this.corona = new THREE.Mesh(
      new THREE.PlaneGeometry(coronaSize, coronaSize),
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: fx.u.uTime,
          uIgnite: fx.u.uSunIgnite,
          uPulse: fx.u.uSunPulse,
          uR0: { value: this.radius / (coronaSize / 2) },
        },
        vertexShader: billboardVert,
        fragmentShader: coronaFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.corona.renderOrder = 2;
    this.billboard.add(this.corona);

    // Prominences: tubes along a unit half-circle, scaled per flare.
    const pts = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI;
      pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
    }
    const arc = new THREE.CatmullRomCurve3(pts);
    const tubeGeo = new THREE.TubeGeometry(arc, 64, 0.12, 10, false);

    this.flares = [];
    const count = quality === 'high' ? 7 : 4;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: fx.u.uTime,
          uIgnite: fx.u.uSunIgnite,
          uLife: { value: 0 },
          uSeed: { value: Math.random() * 10 },
          uHot: { value: 0 },
        },
        vertexShader: flareVert,
        fragmentShader: flareFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const holder = new THREE.Group();
      const mesh = new THREE.Mesh(tubeGeo, mat);
      mesh.renderOrder = 2;
      holder.add(mesh);
      this.billboard.add(holder);
      const f = { holder, mesh, mat, life: 0, dur: 1, w: 1, h: 1 };
      this.respawn(f, Math.random());
      this.flares.push(f);
    }
  }

  respawn(f, startLife = 0, big = false) {
    const a = big ? Math.PI * (0.35 + Math.random() * 0.3) : Math.random() * Math.PI * 2;
    const r = this.radius * 0.985;
    f.holder.position.set(Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.5) * 0.4);
    f.holder.rotation.set(0, 0, a - Math.PI / 2);
    f.w = big ? 0.6 + Math.random() * 0.35 : 0.22 + Math.random() * 0.4;
    f.h = big ? 1.1 + Math.random() * 0.6 : 0.25 + Math.random() * 0.6;
    f.dur = big ? 3.2 : 2.6 + Math.random() * 3.2;
    f.life = startLife;
    f.mat.uniforms.uSeed.value = Math.random() * 10;
    f.mat.uniforms.uHot.value = big ? 1 : 0;
    f.mesh.scale.set(f.w, 0.001, 1);
  }

  /** Called on the BUGGIN hit: launch a big prominence. */
  burst() {
    let oldest = this.flares[0];
    for (const f of this.flares) if (f.life > oldest.life) oldest = f;
    this.respawn(oldest, 0, true);
  }

  update(dt, camera) {
    this.billboard.quaternion.copy(camera.quaternion);
    const ig = fx.u.uSunIgnite.value;
    this.group.scale.setScalar(Math.max(0.0001, ig));

    for (const f of this.flares) {
      f.life += dt / f.dur;
      if (f.life >= 1) this.respawn(f, 0);
      const grow = 1 - Math.pow(1 - Math.min(1, f.life * 2.2), 3);
      f.mesh.scale.set(f.w, Math.max(0.001, f.h * grow), 1);
      f.mat.uniforms.uLife.value = f.life;
      f.mat.uniforms.uHot.value *= 0.985;
    }
  }
}
