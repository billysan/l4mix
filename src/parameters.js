export const MAX_SOURCES = 2;
export const PARAMETERS = [
  { key: 'opacity', label: 'OPACITY', min: 0, max: 1, step: .01, initial: 0, master: 1, unit: '%', scale: 100, group: 'mix' },
  { key: 'inversion', label: 'INVERT', min: 0, max: 1, step: .01, initial: 0, unit: '%', scale: 100 },
  { key: 'brightness', label: 'BRIGHT', min: -1, max: 1, step: .01, initial: 0, scale: 100, signed: true },
  { key: 'contrast', label: 'CONTRAST', min: 0, max: 3, step: .01, initial: 1, unit: '×' },
  { key: 'saturation', label: 'SATURATE', min: 0, max: 3, step: .01, initial: 1, unit: '×' },
  { key: 'red', label: 'RED', min: 0, max: 2, step: .01, initial: 1, unit: '×', group: 'red' },
  { key: 'green', label: 'GREEN', min: 0, max: 2, step: .01, initial: 1, unit: '×', group: 'green' },
  { key: 'blue', label: 'BLUE', min: 0, max: 2, step: .01, initial: 1, unit: '×', group: 'blue' },
  { key: 'mirrorX', label: 'CLONE X', min: 1, max: 16, step: 1, initial: 1, unit: '×' },
  { key: 'mirrorY', label: 'CLONE Y', min: 1, max: 16, step: 1, initial: 1, unit: '×' },
  { key: 'hue', label: 'HUE', min: -180, max: 180, step: 1, initial: 0, unit: '°', signed: true },
  { key: 'pixelation', label: 'PIXELATE', min: 1, max: 128, step: 1, initial: 1, unit: 'px' },
  { key: 'rotation', label: 'ROTATE', min: 0, max: 360, step: 1, initial: 0, unit: '°' },
  ...['redX', 'redY', 'greenX', 'greenY', 'blueX', 'blueY', 'slideX', 'slideY'].map(key => ({
    key, label: ({redX: 'R X', redY: 'R Y', greenX: 'G X', greenY: 'G Y', blueX: 'B X', blueY: 'B Y', slideX: 'X', slideY: 'Y'})[key],
    min: -1, max: 1, step: .001, initial: 0, unit: '%', scale: 100, signed: true,
  })),
];
export function defaults(master = false) {
  return Object.fromEntries(PARAMETERS.map(p => [p.key, master ? (p.master ?? p.initial) : p.initial]));
}
export function clampParameter(p, value) {
  if (!Number.isFinite(value)) return p.initial;
  return Number(Math.min(p.max, Math.max(p.min, Math.round(value / p.step) * p.step)).toFixed(4));
}
export function formatParameter(p, value) {
  const scaled = value * (p.scale || 1);
  const digits = Math.max(0, Math.ceil(-Math.log10(p.step * (p.scale || 1))));
  return `${p.signed && scaled > 0 ? '+' : ''}${scaled.toFixed(digits)}${p.unit || ''}`;
}
