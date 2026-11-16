import * as THREE from 'three';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import fontData from './fonts/helvetiker_bold.typeface.json';
import { fx } from './fx.js';
import { RINGS, PHRASE } from './config.js';
import { envelopes } from './shaders/common.js';

const vert = /* glsl */ `
attribute vec4 aWord;   // x: group centre angle, y: word type (0 BU, 1 BU, 2 BUGGIN), z: word offset angle
attribute vec4 aLetter; // x: letter centre x (word-local), y: letter index, z/w: randoms
uniform float uRadius;
uniform float uSpin;
uniform float uCapH;
uniform float uLettersIn;
uniform float uNova;
uniform float uNovaT;
uniform float uShockSpeed;
uniform vec3 uBeatT;
uniform vec2 uShockT;
varying vec3 vN;
varying vec3 vWp;
varying float vNz;
varying float vH;
varying float vType;
varying float vFlash;
${envelopes}

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
  vec3 p = position;
  vec3 n = normal;
  float type = aWord.y;
  float li = aLetter.y;
  float r1 = aLetter.z;
  float r2 = aLetter.w;
  vec3 pivot = vec3(aLetter.x, 0.0, 0.0);
  vec3 lp = p - pivot;

  // Beat: each word pops on its syllable.
  float tPop = type < 0.5 ? uBeatT.x : (type < 1.5 ? uBeatT.y : uBeatT.z);
  float pop = popEnv(tPop - li * 0.03);
  float s = 1.0 + (type > 1.5 ? 0.4 : 0.6) * pop;

  // BUGGIN shockwave: letters bounce as the ring of light passes them.
  float arrive = uRadius / uShockSpeed;
  float b = bounceEnv(uShockT.x - arrive - li * 0.025) + bounceEnv(uShockT.y - arrive * 0.6 - li * 0.02) * 0.6;
  float wob = b * (r1 - 0.5) * 1.1;

  lp *= s;
  lp.xy = rot2(wob) * lp.xy;
  n.xy = rot2(wob) * n.xy;

  // Intro fly-in: tumble in from the sky.
  float pin = clamp(uLettersIn * 1.7 - r2 * 0.7, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - pin, 3.0);
  float spin = (1.0 - e) * (r1 - 0.5) * 9.0;
  lp.xz = rot2(spin) * lp.xz;
  n.xz = rot2(spin) * n.xz;
  lp *= mix(0.2, 1.0, e);

  // Supernova tumble.
  float tum = uNova * ((r1 - 0.5) * 7.0 + uNovaT * (r2 - 0.5) * 2.0);
  lp.yz = rot2(tum) * lp.yz;
  n.yz = rot2(tum) * n.yz;
  lp.xy = rot2(tum * 0.6) * lp.xy;
  n.xy = rot2(tum * 0.6) * n.xy;

  p = lp + pivot;
  p.y += b * 1.25 + max(pop, 0.0) * 0.18;

  // Keep the phrase readable: as a group passes the sides of the ring each
  // word swings round to face the viewer (psi: 0 = facing out, PI = facing in)
  // and the words shuffle so it still reads BU BU BUGGIN from the back.
  // The flip happens exactly where the group turns edge-on to the camera, so
  // the viewer never sees text from behind; it rotates toward the camera.
  float phiG = aWord.x + uSpin;
  vec2 nc = vec2(sin(phiG), cos(phiG));          // outward normal (xz)
  vec2 tc = vec2(cos(phiG), -sin(phiG));         // tangent (xz)
  vec2 toCam = normalize(cameraPosition.xz - nc * uRadius);
  float facing = dot(nc, toCam);
  float flip = smoothstep(0.14, -0.14, facing);
  float psi = (dot(tc, toCam) > 0.0 ? -1.0 : 1.0) * 3.14159265 * flip;
  float cs = cos(psi), sn = sin(psi);
  float phi = phiG + aWord.z * cs;
  vec3 q = vec3(p.x * cs - p.z * sn, p.y, p.x * sn + p.z * cs);
  vec3 nq = vec3(n.x * cs - n.z * sn, n.y, n.x * sn + n.z * cs);

  // Bend along the orbit.
  float rr = uRadius + q.z;
  float ang = phi + q.x / uRadius;
  vec3 wp = vec3(rr * sin(ang), q.y, rr * cos(ang));
  vec3 T = vec3(cos(ang), 0.0, -sin(ang));
  vec3 N = vec3(sin(ang), 0.0, cos(ang));
  vec3 wn = T * nq.x + vec3(0.0, nq.y, 0.0) + N * nq.z;

  vec3 radial = vec3(sin(phi), 0.0, cos(phi));
  wp += (radial * (4.0 + r1 * 10.0) + vec3(0.0, 14.0 + r2 * 10.0, 0.0)) * pow(1.0 - e, 2.0);

  // Supernova blast: out, up, and sideways — then drift while hanging.
  wp += (radial * (2.5 + r1 * 7.0) + vec3(0.0, 1.5 + r2 * 6.0 + uNovaT * 0.5, 0.0) + T * (r2 - 0.5) * 4.0) * uNova;

  vec4 world = modelMatrix * vec4(wp, 1.0);
  vWp = world.xyz;
  vN = normalize(mat3(modelMatrix) * wn);
  vNz = normal.z;
  vH = clamp(position.y / uCapH, 0.0, 1.0);
  vType = type;
  vFlash = max(pop, 0.0) * 1.3 + flashEnv(uShockT.x - arrive) * 0.9 + flashEnv(uShockT.y - arrive * 0.6) * 0.9 + uNova * 0.5;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const frag = /* glsl */ `
uniform vec3 uSunPos;
varying vec3 vN;
varying vec3 vWp;
varying float vNz;
varying float vH;
varying float vType;
varying float vFlash;
void main() {
  vec3 n = normalize(vN);
  float front = smoothstep(0.55, 0.95, vNz);
  float bevel = (1.0 - front) * smoothstep(0.12, 0.5, abs(vNz));

  bool bug = vType > 1.5;
  vec3 face = bug ? mix(vec3(0.75, 0.16, 0.012), vec3(0.95, 0.5, 0.06), vH)
                  : mix(vec3(0.38, 0.012, 0.008), vec3(0.9, 0.07, 0.025), vH);
  vec3 side = bug ? vec3(0.22, 0.045, 0.006) : vec3(0.16, 0.01, 0.006);

  vec3 L = normalize(uSunPos - vWp);
  vec3 V = normalize(cameraPosition - vWp);
  float diff = max(dot(n, L), 0.0);
  float key = max(dot(n, normalize(vec3(0.25, 0.8, 0.6))), 0.0);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);

  vec3 col = mix(side, face, front);
  col *= 0.3 + 0.7 * diff + 0.3 * key;
  col += face * front * 0.55;                                  // neon-sign face
  col += vec3(1.5, 0.75, 0.28) * bevel * (0.25 + diff * 1.1);  // hot bevel edge
  col += vec3(0.9, 0.28, 0.06) * fres * 0.35;
  col *= 1.0 + vFlash * 1.6;
  gl_FragColor = vec4(col, 1.0);
}
`;

export class OrbitText {
  constructor(quality) {
    this.font = new Font(fontData);
    this.group = new THREE.Group();
    this.rings = [];
    const hq = quality === 'high';
    const glyphCache = new Map();

    const glyph = (ch, size) => {
      const key = ch + size;
      if (glyphCache.has(key)) return glyphCache.get(key);
      const depth = size * 0.34;
      const g = new THREE.ExtrudeGeometry(this.font.generateShapes(ch, size), {
        depth,
        bevelEnabled: true,
        bevelThickness: size * 0.07,
        bevelSize: size * 0.045,
        bevelSegments: hq ? 3 : 2,
        curveSegments: hq ? 6 : 4,
      });
      g.translate(0, 0, -depth / 2);
      const adv = this.font.data.glyphs[ch].ha * (size / this.font.data.resolution);
      const out = { geo: g, adv };
      glyphCache.set(key, out);
      return out;
    };

    RINGS.forEach((ring, ri) => {
      if (!ring.groups) {
        this.rings.push(null);
        return;
      }
      const size = ring.size;
      const space = size * 0.55;
      const words = PHRASE.map((w) => {
        const glyphs = [...w.text].map((ch) => glyph(ch, size));
        const len = glyphs.reduce((s, g) => s + g.adv, 0);
        return { ...w, glyphs, len };
      });
      const geos = [];
      const anchors = [];
      const offset = ri * 1.37;

      const groupLen = words.reduce((s, w) => s + w.len, 0) + space * (words.length - 1);
      for (let gi = 0; gi < ring.groups; gi++) {
        const groupCenter = offset + (gi / ring.groups) * Math.PI * 2;
        let cursor = -groupLen / 2;
        let letterIndex = 0;
        for (const word of words) {
          const wordOffset = (cursor + word.len / 2) / ring.r;
          anchors.push({ angle: groupCenter + wordOffset, type: word.type, half: word.len / 2 });
          let lx = -word.len / 2;
          for (const gl of word.glyphs) {
            const g = gl.geo.clone();
            g.translate(lx, 0, 0);
            const count = g.attributes.position.count;
            const aWord = new Float32Array(count * 4);
            const aLetter = new Float32Array(count * 4);
            const r1 = Math.random();
            const r2 = Math.random();
            const cx = lx + gl.adv / 2;
            for (let v = 0; v < count; v++) {
              aWord.set([groupCenter, word.type, wordOffset, ri], v * 4);
              aLetter.set([cx, letterIndex, r1, r2], v * 4);
            }
            g.setAttribute('aWord', new THREE.BufferAttribute(aWord, 4));
            g.setAttribute('aLetter', new THREE.BufferAttribute(aLetter, 4));
            geos.push(g);
            lx += gl.adv;
            letterIndex++;
          }
          cursor += word.len + space;
        }
      }

      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      const uSpin = { value: 0 };
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uRadius: { value: ring.r },
          uSpin,
          uCapH: { value: size * 0.74 },
          uLettersIn: fx.u.uLettersIn,
          uNova: fx.u.uNova,
          uNovaT: fx.u.uNovaT,
          uShockSpeed: fx.u.uShockSpeed,
          uBeatT: fx.u.uBeatT,
          uShockT: fx.u.uShockT,
          uSunPos: fx.u.uSunPos,
        },
        vertexShader: vert,
        fragmentShader: frag,
      });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.rings.push({ mesh, uSpin, anchors, ring, index: ri });
    });

    for (const g of glyphCache.values()) g.geo.dispose();
  }

  /** World position of a word's centre (ignores per-letter animation). */
  anchorPosition(ringEntry, anchor, out, along = 0) {
    const phi = anchor.angle + ringEntry.uSpin.value + along / ringEntry.ring.r;
    const r = ringEntry.ring.r;
    return out.set(Math.sin(phi) * r, ringEntry.ring.size * 0.4, Math.cos(phi) * r);
  }

  update() {
    for (const r of this.rings) {
      if (r) r.uSpin.value = fx.u.uSpins.value[r.index];
    }
  }
}
