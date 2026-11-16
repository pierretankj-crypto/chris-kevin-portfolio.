// Orbit layout. Inner rings spin faster (Kepler-ish) and alternate direction.
export const RINGS = [
  { r: 3.3, groups: 2, size: 0.5, speed: 0.2 },
  { r: 4.8, groups: 3, size: 0.6, speed: -0.125 },
  { r: 6.4, groups: 3, size: 0.72, speed: 0.082 },
  { r: 8.1, groups: 4, size: 0.86, speed: -0.058 },
  { r: 9.9, groups: 0, size: 0, speed: 0.044 },
];

export const PHRASE = [
  { text: 'BU', type: 0 },
  { text: 'BU', type: 1 },
  { text: 'BUGGIN', type: 2 },
];

// Beat timing (seconds): BU, BU, BUGGIN inside one loop.
export const BEAT = {
  period: 4.6,
  hits: [0, 0.4, 0.86],
};
