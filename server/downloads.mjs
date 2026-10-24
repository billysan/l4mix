import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function youtubeURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Paste a valid YouTube video URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(url.hostname)) {
    throw new Error('Use an https://youtube.com or https://youtu.be video URL.');
  }
  const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|live|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  if (!/^[\w-]{11}$/.test(id || '')) throw new Error('Paste a single YouTube video link, not a channel or playlist.');
  return `https://www.youtube.com/watch?v=${id}`;
}

export async function downloadVideo(value, mediaDirectory, signal, executable = process.env.YT_DLP || 'yt-dlp') {
  const url = youtubeURL(value);
  const temporary = await mkdtemp(path.join(tmpdir(), 'mist-download-'));
  try {
    const args = ['--ignore-config', '--no-playlist', '--no-progress', '--no-warnings', '--no-simulate',
      '--socket-timeout', '20', '--retries', '2', '--max-filesize', '512M', '--match-filter', '!is_live',
      '--fixup', 'never', '--write-info-json', '--no-write-thumbnail', '--no-write-subs',
      '-f', 'bv[ext=mp4][vcodec^=avc1][height<=1080]/b[ext=mp4][vcodec^=avc1][height<=1080]',
      '-o', path.join(temporary, 'video.%(ext)s'), '--', url];
    await new Promise((resolve, reject) => {
      const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '', timedOut = false;
      const cancel = () => child.kill('SIGKILL');
      const timer = setTimeout(() => { timedOut = true; cancel(); }, 300000);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
      child.once('error', error => {
        clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        reject(new Error(error.code === 'ENOENT' ? 'yt-dlp is not installed. Install it or set YT_DLP to its executable path, then restart the server.' : 'Could not start yt-dlp.'));
      });
      child.once('close', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        if (signal?.aborted) reject(new Error('Download cancelled.'));
        else if (timedOut) reject(new Error('Download timed out. Try a shorter video.'));
        else if (code !== 0) reject(new Error(stderr.match(/ERROR:[^\n]+/g)?.at(-1)?.replace(/^ERROR:\s*/, '') || 'YouTube download failed. Try another video or update yt-dlp.'));
        else resolve();
      });
    });
    const video = path.join(temporary, 'video.mp4');
    const info = JSON.parse(await readFile(path.join(temporary, 'video.info.json'), 'utf8'));
    const size = (await stat(video)).size;
    if (!size || size > 512 * 1024 * 1024) throw new Error('Video is empty or exceeds the 512 MB download limit.');
    if (signal?.aborted) throw new Error('Download cancelled.');
    const title = String(info.title || 'YouTube video').replace(/[\x00-\x1f/\\]/g, '').slice(0, 120) || 'YouTube video';
    const filename = `${randomUUID()}.mp4`;
    await mkdir(mediaDirectory, { recursive: true });
    // Both locations may be on different filesystems.
    const staging = path.join(mediaDirectory, `${filename}.part`);
    try {
      await copyFile(video, staging);
      if (signal?.aborted) throw new Error('Download cancelled.');
      await rename(staging, path.join(mediaDirectory, filename));
    }
    finally { await rm(staging, { force: true }); }
    return { url: `/media/${filename}`, name: `${title}.mp4` };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
