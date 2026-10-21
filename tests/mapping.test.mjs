import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultCorners, inverseMapping, validCorners } from '../src/mapping.js';

function apply(matrix, x, y) {
  const w = matrix[2] * x + matrix[5] * y + matrix[8];
  return [(matrix[0] * x + matrix[3] * y + matrix[6]) / w, (matrix[1] * x + matrix[4] * y + matrix[7]) / w];
}
function near(actual, expected) { actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-5, `${actual} != ${expected}`)); }
test('projective mapping recovers the image corners and perspective interior', () => {
  const corners = [[.25, 0], [.75, 0], [1, 1], [0, 1]];
  const matrix = inverseMapping(corners);
  corners.forEach((p, i) => near(apply(matrix, ...p), defaultCorners()[i]));
  // For this trapezoid y = v / (2-v), so image center projects to y = 1/3.
  near(apply(matrix, .5, 1/3), [.5, .5]);
  near(apply(inverseMapping(defaultCorners()), .17, .83), [.17, .83]);
});
test('crossed, concave, collapsed, non-finite and out-of-bounds corners are rejected', () => {
  for (const points of [ [[0,0],[1,1],[1,0],[0,1]], [[0,0],[1,0],[.1,.1],[0,1]], [[0,0],[0,0],[1,1],[0,1]], [[NaN,0],[1,0],[1,1],[0,1]], [[-.1,0],[1,0],[1,1],[0,1]] ]) {
    assert.equal(validCorners(points), false); assert.equal(inverseMapping(points), null);
  }
});
