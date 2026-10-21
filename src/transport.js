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
  pause() { this.paused = true; this.video.pause(); this.onChange(); }
  dispose() { this.disposed = true; this.video.removeEventListener('ended', this.ended); this.video.pause(); }
}
