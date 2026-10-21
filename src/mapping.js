// Normalized screen coordinates, clockwise from top left.
export function defaultCorners() { return [[0, 0], [1, 0], [1, 1], [0, 1]]; }

export function validCorners(points) {
  if (points?.length !== 4 || points.some(p => p.length !== 2 || p.some(v => !Number.isFinite(v) || v < 0 || v > 1))) return false;
  // Reject crossed, concave, or nearly collapsed quads before solving a homography.
  return points.every((p, i) => {
    const q = points[(i + 1) % 4], r = points[(i + 2) % 4];
    return (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]) > .001;
  });
}

export function inverseMapping(points) {
  if (!validCorners(points)) return null;
  // Solve destination -> original image directly. Each point supplies two equations.
  const rows = [];
  const original = defaultCorners();
  points.forEach(([x, y], i) => {
    const [u, v] = original[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (Math.abs(rows[pivot][col]) < 1e-10) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    for (let j = col; j < 9; j++) rows[col][j] /= divisor;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = rows[row][col];
      for (let j = col; j < 9; j++) rows[row][j] -= factor * rows[col][j];
    }
  }
  const h = rows.map(row => row[8]);
  return new Float32Array([h[0], h[3], h[6], h[1], h[4], h[7], h[2], h[5], 1]);
}
