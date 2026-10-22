import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpuCounters, cpuPercent, systemTelemetry } from '../server/telemetry.mjs';

test('CPU usage measures the busy fraction across cores without dividing by zero', () => {
  const before = cpuCounters([{ times: { idle: 100, user: 50, sys: 50 } }, { times: { idle: 100, user: 50, sys: 50 } }]);
  const after = cpuCounters([{ times: { idle: 125, user: 100, sys: 75 } }, { times: { idle: 175, user: 75, sys: 50 } }]);
  assert.equal(cpuPercent(before, after), 50);
  assert.equal(cpuPercent(before, before), null);
});
test('system telemetry returns bounded host measurements and supports missing GPU counters', async () => {
  const stats = await systemTelemetry();
  assert.ok(stats.cpu === null || stats.cpu >= 0 && stats.cpu <= 100);
  assert.ok(stats.gpu === null || stats.gpu >= 0 && stats.gpu <= 100);
  assert.ok(stats.memoryTotal > 0 && stats.memoryUsed >= 0 && stats.memoryUsed <= stats.memoryTotal);
});
