import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { fx } from './fx.js';
import { hash } from './shaders/common.js';

const passVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Screen-space light shafts streaming out of the sun, occluded by whatever
// is darker in front of it (the friend's silhouette, the letters).
const GodRaysShader = (samples) => ({
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.6) },
    uIntensity: { value: 0.0 },
    uThreshold: { value: 1.5 },
    uDensity: { value: 0.8 },
    uDecay: { value: 0.95 },
    uWeight: { value: 0.012 },
    uTime: { value: 0 },
  },
  vertexShader: passVert,
  fragmentShader: /* glsl */ `
    #define SAMPLES ${samples}
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uIntensity;
    uniform float uThreshold;
    uniform float uDensity;
    uniform float uDecay;
    uniform float uWeight;
    uniform float uTime;
    varying vec2 vUv;
    ${hash}
    // First post pass: scrub NaN/Inf and absurd HDR so one bad pixel can never
    // be smeared across the whole frame by the bloom (= a black screen).
    vec3 safe(vec3 c) {
      if (any(isnan(c)) || any(isinf(c))) return vec3(0.0);
      return min(c, vec3(64.0));
    }
    void main() {
      vec3 base = safe(texture2D(tDiffuse, vUv).rgb);
      if (uIntensity <= 0.001) { gl_FragColor = vec4(base, 1.0); return; }
      vec2 delta = (vUv - uSun) * uDensity / float(SAMPLES);
      vec2 c = vUv - delta * hash12(vUv * 1000.0 + uTime);
      float illum = 1.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < SAMPLES; i++) {
        c -= delta;
        vec3 s = safe(texture2D(tDiffuse, c).rgb);
        acc += max(s - uThreshold, 0.0) * illum * uWeight;
        illum *= uDecay;
      }
      gl_FragColor = vec4(base + acc * uIntensity * vec3(1.0, 0.72, 0.45), 1.0);
    }
  `,
});

// Final grade: chromatic aberration, anamorphic streak, flash, vignette,
// ACES tone mapping, sRGB encode and film grain.
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uCA: { value: 0.0015 },
    uFlash: { value: 0 },
    uExposure: { value: 1 },
    uStreak: { value: 0.035 },
    uAspect: { value: 1 },
    uGrain: { value: 0.045 },
    uSun: { value: new THREE.Vector2(0.5, 0.6) },
  },
  vertexShader: passVert,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uCA;
    uniform float uFlash;
    uniform float uExposure;
    uniform float uStreak;
    uniform float uAspect;
    uniform float uGrain;
    uniform vec2 uSun;
    varying vec2 vUv;
    ${hash}

    vec3 RRTAndODTFit(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 aces(vec3 color) {
      const mat3 ACESInputMat = mat3(
        vec3(0.59719, 0.07600, 0.02840),
        vec3(0.35458, 0.90834, 0.13383),
        vec3(0.04823, 0.01566, 0.83777)
      );
      const mat3 ACESOutputMat = mat3(
        vec3(1.60475, -0.10208, -0.00327),
        vec3(-0.53108, 1.10813, -0.07276),
        vec3(-0.07367, -0.00605, 1.07602)
      );
      color = ACESInputMat * (color / 0.6);
      color = RRTAndODTFit(color);
      return clamp(ACESOutputMat * color, 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
    }

    void main() {
      vec2 uv = vUv;
      vec2 fromC = uv - 0.5;
      float r2 = dot(fromC * vec2(uAspect, 1.0), fromC * vec2(uAspect, 1.0));

      // radial chromatic aberration (stronger at the edges)
      vec2 off = fromC * uCA * (0.4 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;

      // anamorphic streak: wide horizontal smear of the hottest pixels
      vec3 streak = vec3(0.0);
      for (int i = -7; i <= 7; i++) {
        float fi = float(i);
        vec3 s = texture2D(tDiffuse, uv + vec2(fi * 0.018, 0.0)).rgb;
        streak += max(s - 2.2, 0.0) * exp(-abs(fi) * 0.22);
      }
      col += streak * uStreak * vec3(1.0, 0.55, 0.3);

      col *= uExposure;
      // flash blooms out from the sun rather than greying the whole frame
      float fd = length((uv - uSun) * vec2(uAspect, 1.0));
      col += vec3(1.0, 0.8, 0.55) * uFlash * (exp(-fd * 2.6) * 4.0 + 0.06);

      // grade: lift shadows toward deep plum, warm highlights
      col = col + vec3(0.006, 0.0, 0.008) * (1.0 - smoothstep(0.0, 0.2, col.g));

      col = aces(col);

      // vignette
      float vig = smoothstep(1.15, 0.25, length(fromC * vec2(uAspect * 0.85, 1.0)));
      col *= mix(0.42, 1.0, vig);

      col = toSRGB(col);
      // film grain in display space
      float g = hash12(uv * vec2(1931.0, 1773.0) + fract(uTime * 13.7) * 100.0) - 0.5;
      col += g * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Post {
  constructor(renderer, scene, camera, quality, size) {
    const hq = quality === 'high';
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: hq ? 2 : 0,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));

    this.rays = new ShaderPass(GodRaysShader(hq ? 48 : 24));
    this.composer.addPass(this.rays);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.45, 1.0);
    this.composer.addPass(this.bloom);

    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);

    this.camera = camera;
    this.sunWorld = fx.u.uSunPos.value;
    this._v = new THREE.Vector3();
  }

  setSize(w, h, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.final.uniforms.uAspect.value = w / h;
  }

  render(dt, time) {
    // project the sun to screen for the ray origin
    const p = this._v.copy(this.sunWorld).project(this.camera);
    this.rays.uniforms.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    this.rays.uniforms.uIntensity.value = Math.min(1, fx.u.uSunIgnite.value) * (1.0 + fx.u.uSunPulse.value * 0.5);
    this.rays.uniforms.uTime.value = time;

    const f = this.final.uniforms;
    f.uTime.value = time;
    f.uSun.value.copy(this.rays.uniforms.uSun.value);
    f.uCA.value = 0.0007 + fx.ca * 0.018;
    f.uFlash.value = fx.flash;
    f.uExposure.value = fx.exposure;

    this.composer.render(dt);
  }
}
