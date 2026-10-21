import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SourceTransport } from '../src/transport.js';

class Video extends EventTarget {
  constructor() { super(); this.currentTime = 1; this.duration = 1; this.readyState = 4; this.seeking = false; this.playCount = 0; this.paused = true; }
  async play() { this.paused = false; this.playCount++; }
  pause() { this.paused = true; }
}
test('ping-pong reverses at the end, pauses in place, then resumes from the beginning', async () => {
  const video = new Video(), transport = new SourceTransport(video);
  video.currentTime = .8; await transport.play(); transport.setPingPong(true);
  video.currentTime = 1; video.dispatchEvent(new Event('ended'));
  assert.equal(transport.direction, -1); assert.equal(transport.paused, false); assert.equal(video.paused, true);
  transport.update(0); transport.update(80); assert.ok(video.currentTime < 1);
  transport.pause(); const time = video.currentTime; transport.update(500); assert.equal(video.currentTime, time);
  await transport.play(); transport.update(600); transport.update(680); assert.ok(video.currentTime < time);
  video.currentTime = .02; transport.update(760); assert.equal(transport.direction, 1); assert.equal(transport.paused, false); assert.equal(video.paused, false);
});
test('turning rewind off resumes forward playback, disposing prevents reverse updates', async () => {
  const video = new Video(), transport = new SourceTransport(video);
  transport.setPingPong(true); await transport.play(); video.dispatchEvent(new Event('ended'));
  transport.setPingPong(false); assert.equal(transport.direction, 1); assert.equal(video.loop, true); assert.equal(video.paused, false);
  transport.setPingPong(true); video.dispatchEvent(new Event('ended')); transport.dispose();
  const time = video.currentTime; transport.update(0); transport.update(100); assert.equal(video.currentTime, time); assert.equal(video.paused, true);
});
test('failed playback returns to paused state and reports the failure', async () => {
  const video = new Video(), errors = [];
  video.play = async () => { throw new Error('decode failed'); };
  const transport = new SourceTransport(video, { onError: e => errors.push(e.message) });
  video.currentTime = 0; await transport.play(); assert.equal(transport.paused, true); assert.deepEqual(errors, ['decode failed']);
});
