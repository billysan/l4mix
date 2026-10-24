const paths = {
  play: '<path d="m8 5 11 7-11 7Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="m3 3 18 18M10 5a12 12 0 0 1 12 7 18 18 0 0 1-4 5M6 6a19 19 0 0 0-4 6s3.5 7 10 7a12 12 0 0 0 4-.7"/>',
  shuffle: '<path d="M3 7h3c4 0 8 10 12 10h3M3 17h3c1.5 0 3-1.5 4.5-3.5M13.5 10.5C15 8.5 16.5 7 18 7h3M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  eject: '<path d="m5 14 7-9 7 9ZM5 19h14"/>',
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}
