import http from 'node:http';
import { downloadVideo } from './server/downloads.mjs';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { systemTelemetry } from './server/telemetry.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
const mediaDirectory = path.join(root, 'media');
let downloading = false;
const port = Number(process.env.PORT || 5173);
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/api/download') {
      const json = (status, data) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); } };
      if (req.method !== 'POST') { json(405, { error: 'Use POST.' }); return; }
      if (!['localhost', '127.0.0.1'].includes(new URL(`http://${req.headers.host}`).hostname) || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site' || req.headers['content-type'] !== 'application/json') { json(403, { error: 'Open the mixer locally to download videos.' }); return; }
      if (downloading) { json(409, { error: 'Another download is in progress.' }); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 4096) { json(413, { error: 'URL request is too large.' }); return; } }
      let payload;
      try { payload = JSON.parse(body); } catch { json(400, { error: 'Invalid request.' }); return; }
      if (downloading) { json(409, { error: 'Another download is in progress.' }); return; }
      downloading = true;
      const abort = new AbortController();
      const cancel = () => abort.abort();
      res.on('close', cancel);
      try { json(200, await downloadVideo(payload.url, mediaDirectory, abort.signal)); }
      catch (error) { json(400, { error: error.message }); }
      finally { downloading = false; res.off('close', cancel); }
      return;
    }
    if (/^\/media\/[a-f0-9-]{36}\.mp4$/.test(pathname) && req.method === 'GET') {
      const file = path.join(mediaDirectory, path.basename(pathname));
      const { stat } = await import('node:fs/promises');
      const size = (await stat(file)).size;
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      await pipeline(createReadStream(file), res); return;
    }
    if (pathname === '/api/telemetry') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(await systemTelemetry())); return;
    }
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + path.sep) || (!['index.html', 'output.html', 'style.css', 'favicon.svg'].includes(path.relative(root, file)) && !file.startsWith(path.join(root, 'src') + path.sep) && !file.startsWith(path.join(root, 'assets', 'fonts') + path.sep))) {
      res.writeHead(404).end('Not found'); return;
    }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`MIST mixer → http://localhost:${port}`));
