import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { youtubeURL, downloadVideo } from '../server/downloads.mjs';

test('YouTube links normalize to single videos and reject other hosts, credentials and playlists', () => {
  for (const link of ['https://youtu.be/q030WNZvXrA?t=10', 'https://www.youtube.com/watch?v=q030WNZvXrA&list=extra', 'https://youtube.com/shorts/q030WNZvXrA']) {
    assert.equal(youtubeURL(link), 'https://www.youtube.com/watch?v=q030WNZvXrA');
  }
  for (const link of ['file:///etc/passwd', 'http://localhost/', 'https://youtube.com.evil.com/watch?v=q030WNZvXrA', 'https://user@youtube.com/watch?v=q030WNZvXrA', 'https://youtube.com/playlist?list=abc', '--exec=bad']) assert.throws(() => youtubeURL(link));
});

test('Downloader saves one MP4, passes safe single-stream options and surfaces failures', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mist-download-test-'));
  const executable = path.join(dir, 'fake-yt-dlp');
  try {
    await writeFile(executable, `#!${process.execPath}\nimport fs from 'node:fs';\nconst args=process.argv.slice(2);\nfs.writeFileSync(${JSON.stringify(path.join(dir,'args.json'))},JSON.stringify(args));\nconst out=args[args.indexOf('-o')+1];\nfs.writeFileSync(out.replace('%(ext)s','mp4'),'video bytes');\nfs.writeFileSync(out.replace('%(ext)s','info.json'),JSON.stringify({title:'A / title'}));\n`, { mode: 0o755 });
    const media = path.join(dir, 'media');
    const result = await downloadVideo('https://youtu.be/q030WNZvXrA', media, null, executable);
    assert.equal(result.name, 'A  title.mp4');
    assert.equal(await readFile(path.join(media, path.basename(result.url)), 'utf8'), 'video bytes');
    assert.equal((await readdir(media)).length, 1);
    const args = JSON.parse(await readFile(path.join(dir, 'args.json'), 'utf8'));
    assert.equal(args[args.indexOf('-f') + 1].includes('+'), false);
    assert.ok(args.includes('--ignore-config')); assert.ok(args.includes('--no-playlist'));
    assert.equal(args.at(-2), '--');
    await assert.rejects(readFile(args[args.indexOf('-o') + 1].replace('%(ext)s', 'mp4')));
    await assert.rejects(downloadVideo('https://youtu.be/q030WNZvXrA', media, null, path.join(dir,'missing')), /not installed/);
    await writeFile(executable, `#!${process.execPath}\nconsole.error('ERROR: unavailable video'); process.exit(1);\n`, { mode: 0o755 });
    await assert.rejects(downloadVideo('https://youtu.be/q030WNZvXrA', media, null, executable), /unavailable video/);
    await writeFile(executable, `#!${process.execPath}\nimport fs from 'node:fs';\nconst args=process.argv.slice(2);\nfs.writeFileSync(${JSON.stringify(path.join(dir,'started'))}, args[args.indexOf('-o')+1]);\nsetInterval(()=>{},1000);\n`, { mode: 0o755 });
    const activeAbort = new AbortController();
    const running = downloadVideo('https://youtu.be/q030WNZvXrA', media, activeAbort.signal, executable);
    for (let i = 0; i < 100; i++) {
      try { await readFile(path.join(dir, 'started')); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    const temporaryOutput = await readFile(path.join(dir, 'started'), 'utf8');
    activeAbort.abort();
    await assert.rejects(running, /cancelled/);
    await assert.rejects(readdir(path.dirname(temporaryOutput)));
    assert.equal((await readdir(media)).length, 1);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(downloadVideo('https://youtu.be/q030WNZvXrA', media, abort.signal, executable), /cancelled/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
