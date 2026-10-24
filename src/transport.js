export class SourceTransport {
  constructor(video, { onChange = () => {}, onError = () => {} } = {}) {
    this.video = video;
    this.onChange = onChange;
    this.onError = onError;
    this.paused = true;
    this.disposed = false;
    video.loop = true;
    this.ended = () => { this.paused = true; this.onChange(); };
    video.addEventListener('ended', this.ended);
  }
  async play() {
    if (this.disposed) return;
    this.paused = false; this.onChange();
    try { await this.video.play(); }
    catch (error) {
      if (this.disposed || error.name === 'AbortError') return;
      this.paused = true; this.onChange(); this.onError(error);
    }
  }
  get seekEnd() {
    if (this.disposed || this.video.readyState < 1) return 0;
    let end = this.video.duration;
    if (!Number.isFinite(end) && this.video.seekable?.length) end = this.video.seekable.end(this.video.seekable.length - 1);
    return Number.isFinite(end) && end > 0 ? Math.max(0, end - .001) : 0;
  }
  get canSeek() { return this.seekEnd > 0; }
  seekTo(time) {
    const end = this.seekEnd;
    if (!end || !Number.isFinite(time)) return false;
    try { this.video.currentTime = Math.max(0, Math.min(end, time)); }
    catch { return false; }
    this.onChange(); return true;
  }
  seekBy(seconds) { return this.seekTo(this.video.currentTime + seconds); }
  seekRandom(random = Math.random) { return this.seekTo(random() * this.seekEnd); }
  pause() { this.paused = true; this.video.pause(); this.onChange(); }
  dispose() { this.disposed = true; this.video.removeEventListener('ended', this.ended); this.video.pause(); }
}
