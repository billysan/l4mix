// Reverse playback uses bounded seeks: negative playbackRate is not portable in browsers.
export class SourceTransport {
  constructor(video, { onChange = () => {}, onError = () => {} } = {}) {
    this.video = video;
    this.onChange = onChange;
    this.onError = onError;
    this.paused = true;
    this.pingPong = false;
    this.direction = 1;
    this.lastTick = null;
    this.endTime = null;
    this.disposed = false;
    video.loop = true;
    this.ended = () => {
      if (this.video.currentTime > 0) this.endTime = this.video.currentTime;
      if (this.pingPong && !this.paused) {
        this.direction = -1; this.lastTick = null; video.pause();
      } else this.paused = true;
      this.onChange();
    };
    video.addEventListener('ended', this.ended);
  }
  async play() {
    if (this.disposed) return;
    this.paused = false; this.lastTick = null;
    if (this.pingPong && Number.isFinite(this.video.duration) && this.video.currentTime >= this.video.duration - .005) this.direction = -1;
    this.onChange();
    if (this.direction < 0) { this.video.pause(); return; }
    try { await this.video.play(); }
    catch (error) {
      if (this.disposed || error.name === 'AbortError') return;
      this.paused = true; this.onChange(); this.onError(error);
    }
  }
  pause() { this.paused = true; this.lastTick = null; this.video.pause(); this.onChange(); }
  setPingPong(enabled) {
    this.pingPong = enabled; this.video.loop = !enabled;
    if (!enabled && this.direction < 0) {
      this.direction = 1; this.lastTick = null;
      if (!this.paused) this.play();
    }
    this.onChange();
  }
  update(now) {
    if (this.disposed || this.paused || this.direction > 0) return;
    const video = this.video;
    if (!Number.isFinite(Number.isFinite(video.duration) ? video.duration : this.endTime) || video.readyState < 2 || video.seeking) { this.lastTick = now; return; }
    if (this.lastTick == null) { this.lastTick = now; return; }
    if (now - this.lastTick < 1000 / 24) return;
    const step = Math.min(.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    video.currentTime = Math.max(0, video.currentTime - step);
    if (video.currentTime <= .001) {
      this.direction = 1; this.lastTick = null; this.play();
    }
  }
  dispose() { this.disposed = true; this.video.removeEventListener('ended', this.ended); this.video.pause(); }
}
