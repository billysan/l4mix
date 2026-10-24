import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARAMETERS, defaults, clampParameter, formatParameter } from '../src/parameters.js';

test('sources start invisible, while master passes the mix through', () => {
  assert.equal(defaults().opacity, 0);
  assert.equal(defaults(true).opacity, 1);
  assert.equal(defaults().mirrorX, 1);
  assert.equal(defaults().pixelation, 1);
  assert.equal(defaults().edgeAmount, 0); assert.equal(defaults(true).edgeAmount, 0);
  assert.equal(defaults().edgeWidth, 1); assert.equal(defaults().edgeThreshold, .1);
  for (const key of ['redX', 'redY', 'greenX', 'greenY', 'blueX', 'blueY', 'slideX', 'slideY']) {
    assert.equal(defaults()[key], 0); assert.equal(defaults(true)[key], 0);
  }
});
test('numeric input clamps and quantizes without NaN or fractional mirror counts', () => {
  const mirror = PARAMETERS.find(p => p.key === 'mirrorX');
  const opacity = PARAMETERS[0];
  assert.equal(clampParameter(mirror, 2.8), 3);
  assert.equal(clampParameter(mirror, 99), 16);
  assert.equal(clampParameter(opacity, -.1), 0);
  assert.equal(clampParameter(opacity, .567), .57);
  assert.equal(clampParameter(opacity, NaN), 0);
  assert.equal(formatParameter(opacity, .5), '50%');
  assert.equal(formatParameter(PARAMETERS.find(p => p.key === 'slideX'), .001), '+0.1%');
});

test('mapping bounds keep a nonempty ordered rectangle for either channel type', () => {
  for (const master of [false, true]) {
    const values = defaults(master);
    assert.deepEqual(['mapX1','mapX2','mapY1','mapY2'].map(key => values[key]), [0,1,0,1]);
    values.mapX2 = .6;
    assert.equal(clampParameter(PARAMETERS.find(p => p.key === 'mapX1'), .9, values), .599);
    values.mapY1 = .4;
    assert.equal(clampParameter(PARAMETERS.find(p => p.key === 'mapY2'), .1, values), .401);
  }
});
