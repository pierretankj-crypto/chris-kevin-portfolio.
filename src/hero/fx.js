import * as THREE from 'three';

// Shared, animatable state. Uniform objects are shared by reference across
// materials, so tweening `fx.u.x.value` updates every shader that uses it.
export const fx = {
  u: {
    uTime: { value: 0 },
    // intro
    uSunIgnite: { value: 0 },
    uRingsDraw: { value: 0 },
    uLettersIn: { value: 0 },
    uDustIn: { value: 0 },
    uFriendIn: { value: 0 },
    // beat: seconds since BU #1, BU #2, BUGGIN (large = idle)
    uBeatT: { value: new THREE.Vector3(99, 99, 99) },
    // shockwaves: seconds since beat shock, seconds since nova shock
    uShockT: { value: new THREE.Vector2(99, 99) },
    uShockSpeed: { value: 15.0 },
    // supernova
    uNova: { value: 0 },
    uNovaT: { value: 99 },
    // per-ring spin angle (radians)
    uSpins: { value: [0, 0, 0, 0, 0] },
    uSunPulse: { value: 0 },
    // live bass energy from the music (0..1), drives rings / dust / letters
    uMusic: { value: 0 },
    uSunPos: { value: new THREE.Vector3(0, 3.95, -3.7) },
  },
  // JS-only values read by the post pipeline / camera
  flash: 0,
  ca: 0,
  shake: 0,
  exposure: 1,
  timeScale: 1,
};
