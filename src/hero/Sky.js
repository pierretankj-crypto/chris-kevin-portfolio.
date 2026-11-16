import * as THREE from 'three';
import { fx } from './fx.js';
import { simplex3 } from './shaders/common.js';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const skyFrag = /* glsl */ `
uniform float uTime;
uniform float uIgnite;
varying vec3 vDir;
${simplex3}
void main() {
  vec3 d = normalize(vDir);
  float n = fbm5(d * 2.1 + vec3(0.0, 0.0, uTime * 0.004));
  float n2 = fbm3(d * 4.6 + n * 1.5 + vec3(5.0));
  float dens = smoothstep(-0.2, 0.75, n) * (0.55 + 0.45 * n2);
  vec3 violet = vec3(0.045, 0.018, 0.14);
  vec3 magenta = vec3(0.17, 0.016, 0.12);
  vec3 ember = vec3(0.3, 0.055, 0.03);
  vec3 col = mix(violet, magenta, smoothstep(-0.3, 0.5, n2));
  col = mix(col, ember, smoothstep(0.4, 0.95, n) * 0.55);
  col *= dens;
  // dark lanes of dust
  col *= 1.0 - smoothstep(0.1, 0.6, fbm3(d * 7.0 + vec3(2.0))) * 0.7;
  // warm haze behind the sun
  float toSun = max(dot(d, normalize(vec3(0.0, 0.18, -1.0))), 0.0);
  col += vec3(0.16, 0.035, 0.008) * pow(toSun, 8.0) * uIgnite;
  gl_FragColor = vec4(col * 0.7, 1.0);
}
`;

const starVert = /* glsl */ `
attribute vec4 aStar; // size, twinkle speed, phase, warmth
uniform float uTime;
uniform float uPixelRatio;
varying float vA;
varying vec3 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 0.55 + 0.45 * sin(uTime * (0.6 + aStar.y * 3.0) + aStar.z * 6.2831);
  vA = tw * (0.4 + aStar.x * 0.5);
  vCol = mix(vec3(0.75, 0.85, 1.25), vec3(1.3, 0.9, 0.6), aStar.w);
  gl_PointSize = (0.8 + aStar.x * 1.8) * uPixelRatio;
  gl_Position = projectionMatrix * mv;
}
`;

const starFrag = /* glsl */ `
varying float vA;
varying vec3 vCol;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vA;
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

export class Sky {
  constructor(quality, pixelRatio) {
    this.group = new THREE.Group();

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(90, 48, 32),
      new THREE.ShaderMaterial({
        uniforms: { uTime: fx.u.uTime, uIgnite: fx.u.uSunIgnite },
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    // drawn after the other opaques so early-z skips covered pixels,
    // but before the transparent floor
    this.dome.renderOrder = 10;
    this.group.add(this.dome);

    const count = quality === 'high' ? 2600 : 1200;
    const pos = new Float32Array(count * 3);
    const star = new Float32Array(count * 4);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.randomDirection().multiplyScalar(80);
      pos.set([v.x, v.y, v.z], i * 3);
      const big = Math.pow(Math.random(), 4);
      star.set([big, Math.random(), Math.random(), Math.random()], i * 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aStar', new THREE.BufferAttribute(star, 4));
    this.stars = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uTime: fx.u.uTime, uPixelRatio: pixelRatio },
        vertexShader: starVert,
        fragmentShader: starFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.stars.renderOrder = -2;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);
  }

  update(camera) {
    this.group.position.copy(camera.position);
  }
}
