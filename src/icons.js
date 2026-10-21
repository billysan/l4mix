const paths = {
  play: '<path d="m8 5 11 7-11 7Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="m3 3 18 18M10 5a12 12 0 0 1 12 7 18 18 0 0 1-4 5M6 6a19 19 0 0 0-4 6s3.5 7 10 7a12 12 0 0 0 4-.7"/>',
  eject: '<path d="m5 14 7-9 7 9ZM5 19h14"/>',
  rewind: '<path d="m11 5-9 7 9 7Zm10 0-9 7 9 7Z"/>',
  funnel: '<path d="M3 4h18l-7 8v7l-4 2v-9Z"/>',
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}
