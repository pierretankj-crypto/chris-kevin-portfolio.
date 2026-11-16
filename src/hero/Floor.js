import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { fx } from './fx.js';
import { RINGS } from './config.js';
import { simplex3, envelopes } from './shaders/common.js';

const floorVert = /* glsl */ `
uniform mat4 textureMatrix;
varying vec4 vUv;
varying vec3 vWp;
void main() {
  vUv = textureMatrix * vec4(position, 1.0);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const floorFrag = (reflect) => /* glsl */ `
${reflect ? '' : '#define NO_REFLECT'}
uniform vec3 color;
uniform sampler2D tDiffuse;
uniform float uIgnite;
varying vec4 vUv;
varying vec3 vWp;
${simplex3}
void main() {
  vec2 xz = vWp.xz;
  float r = length(xz);
  float n1 = snoise(vec3(xz * 0.9, 0.0));
  float n2 = snoise(vec3(xz * 4.0, 3.0));
  float n3 = snoise(vec3(xz * 16.0, 7.0));
  // puddles: some patches are near-mirror, others rough stone
  float wet = smoothstep(-0.3, 0.4, snoise(vec3(xz * 0.2, 1.0)));

  vec3 V = normalize(cameraPosition - vWp);
  float fres = mix(0.45, 1.0, pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0));

#ifndef NO_REFLECT
  vec2 distort = vec2(n1 * 0.6 + n3 * 0.4, n2) * mix(0.016, 0.004, wet);
  float blur = mix(0.01, 0.0025, wet);
  vec3 refl = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float ang = float(i) * 1.0472 + n3 * 2.0;
    vec2 o = vec2(cos(ang), sin(ang)) * blur;
    refl += texture2DProj(tDiffuse, vec4(vUv.xy + (distort + o) * vUv.w, vUv.zw)).rgb;
  }
  refl /= 6.0;
#else
  vec3 refl = vec3(1.0, 0.32, 0.05) * exp(-r * 0.32) * 0.7 * uIgnite;
#endif

  vec3 stone = vec3(0.017, 0.014, 0.016) * (0.55 + 0.5 * (n2 * 0.5 + 0.5) + 0.35 * n3);
  float reflAmt = mix(0.3, 0.9, wet) * fres;
  vec3 col = stone + refl * reflAmt;
  float alpha = smoothstep(21.0, 11.5, r);
  gl_FragColor = vec4(col, alpha);
}
`;

const decalVert = /* glsl */ `
varying vec3 vWp;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const decalFrag = /* glsl */ `
uniform float uTime;
uniform float uDraw;
uniform float uIgnite;
uniform float uShockSpeed;
uniform vec2 uShockT;
uniform float uMusic;
uniform float uRadii[5];
uniform float uSpins[5];
varying vec3 vWp;
${envelopes}
void main() {
  vec2 xz = vWp.xz;
  float r = length(xz);
  float a = atan(xz.x, xz.y);
  float fw = fwidth(r);
  vec3 col = vec3(0.0);

  for (int i = 0; i < 5; i++) {
    float R = uRadii[i];
    float d = abs(r - R);
    float line = 1.0 - smoothstep(0.014, 0.014 + fw * 1.5, d);
    float halo = exp(-d * 18.0) * 0.28 + exp(-d * 4.0) * 0.03;

    // draw-on: each ring sweeps around with a hot head
    float an = fract((a - uSpins[i]) / 6.2831853 + 0.25 + float(i) * 0.137);
    float prog = clamp(uDraw * 1.35 - float(i) * 0.085, 0.0, 1.0);
    float drawn = 1.0 - smoothstep(prog - 0.002, prog, an);
    float head = exp(-abs(an - prog) * 70.0) * step(prog, 0.999) * step(0.001, prog);

    // pulses of light racing round the ring
    float pp = fract((a - uSpins[i] * 2.5) / 6.2831853 * 3.0 - uTime * (0.06 + float(i) * 0.015));
    float pulse = pow(pp, 14.0) * 2.5;

    float sh = flashEnv(uShockT.x - R / uShockSpeed) * 2.5 + flashEnv(uShockT.y - R / (uShockSpeed * 1.4)) * 2.5;
    float bright = 0.4 + pulse + sh + uMusic * (0.6 + float(i) * 0.12);
    col += vec3(1.0, 0.78, 0.58) * (line * 1.2 + halo) * bright * drawn;
    col += vec3(2.5, 1.4, 0.6) * head * (line * 3.0 + halo * 2.0);
  }

  // shockwave rings sweeping across the floor
  float sr1 = uShockT.x * uShockSpeed;
  float sw1 = exp(-abs(r - sr1) * 2.6) * exp(-uShockT.x * 1.1) * step(0.0, uShockT.x);
  float sr2 = uShockT.y * uShockSpeed * 1.4;
  float sw2 = exp(-abs(r - sr2) * 1.8) * exp(-uShockT.y * 0.9) * step(0.0, uShockT.y);
  col += vec3(1.7, 0.6, 0.14) * (sw1 + sw2 * 1.4);

  // warm pool of sunlight on the floor
  col += vec3(1.2, 0.34, 0.05) * exp(-r * 0.5) * 0.32 * uIgnite;

  col *= smoothstep(16.0, 10.5, r);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Floor {
  constructor(quality, size) {
    this.group = new THREE.Group();
    const geo = new THREE.PlaneGeometry(60, 60);
    this.reflect = quality === 'high';

    if (this.reflect) {
      const scale = 0.5;
      this.mirror = new Reflector(geo, {
        clipBias: 0.003,
        textureWidth: Math.round(size.x * scale),
        textureHeight: Math.round(size.y * scale),
        color: 0xffffff,
        shader: {
          name: 'WetFloor',
          uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
          vertexShader: floorVert,
          fragmentShader: floorFrag(true),
        },
      });
      this.mirror.material.uniforms.uIgnite = fx.u.uSunIgnite;
      this.mirror.material.transparent = true;
      this.mirror.material.depthWrite = false;
      this.floor = this.mirror;
    } else {
      this.floor = this.makePlainFloor(geo);
    }
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.renderOrder = 0;
    this.group.add(this.floor);

    this.decal = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 36),
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: fx.u.uTime,
          uDraw: fx.u.uRingsDraw,
          uIgnite: fx.u.uSunIgnite,
          uShockSpeed: fx.u.uShockSpeed,
          uShockT: fx.u.uShockT,
          uMusic: fx.u.uMusic,
          uRadii: { value: RINGS.map((r) => r.r) },
          uSpins: fx.u.uSpins,
        },
        vertexShader: decalVert,
        fragmentShader: decalFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.decal.rotation.x = -Math.PI / 2;
    this.decal.position.y = 0.012;
    this.decal.renderOrder = 1;
    this.group.add(this.decal);
  }

  makePlainFloor(geo) {
    return new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: {
          color: { value: new THREE.Color(0xffffff) },
          tDiffuse: { value: null },
          textureMatrix: { value: new THREE.Matrix4() },
          uIgnite: fx.u.uSunIgnite,
        },
        vertexShader: floorVert,
        fragmentShader: floorFrag(false),
        transparent: true,
        depthWrite: false,
      }),
    );
  }

  /** Swap the mirror floor for the cheap one (used when the GPU is struggling). */
  disableReflection() {
    if (!this.mirror) return;
    const plain = this.makePlainFloor(this.mirror.geometry);
    plain.rotation.x = -Math.PI / 2;
    plain.renderOrder = 0;
    this.group.add(plain);
    this.group.remove(this.mirror);
    this.mirror.getRenderTarget().dispose();
    this.mirror.material.dispose();
    this.mirror = null;
    this.floor = plain;
    this.reflect = false;
  }

  setSize(w, h) {
    if (this.mirror) this.mirror.getRenderTarget().setSize(Math.max(1, Math.round(w * 0.5)), Math.max(1, Math.round(h * 0.5)));
  }
}
