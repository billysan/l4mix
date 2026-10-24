import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SourceTransport } from '../src/transport.js';

class Video extends EventTarget {
  constructor() { super(); this.currentTime = .4; this.duration = 1; this.readyState = 4; this.paused = true; }
  async play() { this.paused = false; }
  pause() { this.paused = true; }
}
test('normal playback loops forward and pause/resume preserves its position', async () => {
  const video = new Video(), transport = new SourceTransport(video);
  assert.equal(video.loop, true); await transport.play(); assert.equal(video.paused, false);
  transport.pause(); assert.equal(transport.paused, true); assert.equal(video.currentTime, .4);
  await transport.play(); assert.equal(video.currentTime, .4); assert.equal(transport.paused, false);
});
test('disposing pauses the video and prevents restarting it', async () => {
  const video = new Video(), transport = new SourceTransport(video);
  await transport.play(); transport.dispose(); await transport.play(); assert.equal(video.paused, true);
});
test('failed playback returns to paused state and reports the failure', async () => {
  const video = new Video(), errors = [];
  video.play = async () => { throw new Error('decode failed'); };
  const transport = new SourceTransport(video, { onError: e => errors.push(e.message) });
  await transport.play(); assert.equal(transport.paused, true); assert.deepEqual(errors, ['decode failed']);
});

test('five-second jumps preserve playing and paused state and clamp within the clip', async () => {
  const video = new Video(); video.duration = 30; video.currentTime = 12;
  const transport = new SourceTransport(video); await transport.play();
  assert.equal(transport.seekBy(5), true); assert.equal(video.currentTime, 17); assert.equal(transport.paused, false); assert.equal(video.paused, false);
  transport.pause(); transport.seekBy(-5); assert.equal(video.currentTime, 12); assert.equal(video.paused, true);
  transport.seekBy(-50); assert.equal(video.currentTime, 0);
  transport.seekBy(50); assert.equal(video.currentTime, 29.999);
});

test('random seek uses the available clip length and ignores unknown, invalid or disposed media', () => {
  const video = new Video(); video.duration = 40;
  const transport = new SourceTransport(video); transport.seekRandom(() => .25);
  assert.ok(Math.abs(video.currentTime - 10) < .001); assert.equal(transport.paused, true);
  assert.equal(transport.seekTo(NaN), false);
  video.duration = Infinity; assert.equal(transport.canSeek, false); assert.equal(transport.seekBy(5), false);
  video.seekable = { length: 1, end: () => 20 }; assert.equal(transport.canSeek, true);
  transport.seekRandom(() => .5); assert.ok(Math.abs(video.currentTime - 10) < .001);
  transport.dispose(); assert.equal(transport.seekBy(5), false); assert.equal(transport.canSeek, false);
});
