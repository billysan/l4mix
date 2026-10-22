import os from 'node:os';
import { readFile, readdir } from 'node:fs/promises';

export function cpuCounters(cpus) {
  return cpus.reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
}
export function cpuPercent(previous, current) {
  const elapsed = current.total - previous.total;
  return elapsed > 0 ? Math.min(100, Math.max(0, 100 * (1 - (current.idle - previous.idle) / elapsed))) : null;
}
let previous = cpuCounters(os.cpus()), cached = null, sampledAt = 0, pending = null;
async function sample() {
  const current = cpuCounters(os.cpus()), cpu = cpuPercent(previous, current); previous = current;
  const total = os.totalmem(); let available = os.freemem();
  try {
    const info = await readFile('/proc/meminfo', 'utf8');
    const match = info.match(/^MemAvailable:\s+(\d+) kB/m);
    if (match) available = Number(match[1]) * 1024;
  } catch { /* Other platforms use the OS free-memory count. */ }
  let gpu = null;
  try {
    const cards = (await readdir('/sys/class/drm')).filter(name => /^card\d+$/.test(name));
    const readings = await Promise.all(cards.map(async card => {
      try { const value = Number((await readFile(`/sys/class/drm/${card}/device/gpu_busy_percent`, 'utf8')).trim()); return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null; }
      catch { return null; }
    }));
    const supported = readings.filter(value => value !== null);
    if (supported.length) gpu = Math.max(...supported);
  } catch { /* GPU utilization is only available on supported drivers. */ }
  cached = { cpu, gpu, memoryUsed: Math.max(0, total - available), memoryTotal: total };
  sampledAt = performance.now(); return cached;
}
export function systemTelemetry() {
  if (cached && performance.now() - sampledAt < 1000) return Promise.resolve(cached);
  if (!pending) pending = sample().finally(() => { pending = null; });
  return pending;
}
