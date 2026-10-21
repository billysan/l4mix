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
