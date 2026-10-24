import { test, expect } from '@playwright/test';

async function clip(page, width = 320, height = 180, frameCount = 18) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const bytes = await page.evaluate(async ({ width, height, frameCount }) => {
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    const ctx = c.getContext('2d'); const stream = c.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks = []; recorder.ondataavailable = e => chunks.push(e.data);
    const done = new Promise(resolve => { recorder.onstop = resolve; }); recorder.start();
    for (let i = 0; i < frameCount; i++) {
      ctx.fillStyle = '#d05b32'; ctx.fillRect(0, 0, width / 2, height);
      ctx.fillStyle = '#588fc4'; ctx.fillRect(width / 2, 0, width / 2, height);
      ctx.fillStyle = '#d8fa77'; ctx.fillRect((i / frameCount) * width, height / 4, width / 8, height / 2);
      track.requestFrame();
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 34)));
    }
    recorder.stop(); await done; stream.getTracks().forEach(t => t.stop());
    return Array.from(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()));
  }, { width, height, frameCount });
  return { name: 'test-pattern.webm', mimeType: 'video/webm', buffer: Buffer.from(bytes) };
}
async function setValue(row, key, value) {
  await row.locator('.channel-select').click();
  const keys = ['opacity', 'inversion', 'brightness', 'contrast', 'saturation', 'red', 'green', 'blue', 'mirrorX', 'mirrorY', 'hue', 'pixelation'];
  const input = row.locator(`[data-parameter=${keys[key]}] input`); await input.fill(String(value)); await input.press('Enter');
}

test('real shader preserves orientation, mixes opacity, processes effects and restores context', async ({ page }) => {
  await page.goto('/');
  const checks = await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer.js'); const { defaults } = await import('/src/parameters.js');
    const output = document.createElement('canvas'); output.width = 8; output.height = 8;
    const r = new Renderer(output); const master = defaults(true);
    const image = (id, painter, values = {}) => {
      const c = document.createElement('canvas'); c.width = 8; c.height = 8;
      painter(c.getContext('2d'));
      Object.defineProperties(c, { videoWidth: { value: 8 }, videoHeight: { value: 8 }, readyState: { value: 4 } });
      return { id, video: c, values: { ...defaults(), opacity: 1, ...values }, dirty: true };
    };
    const solid = color => ctx => { ctx.fillStyle = color; ctx.fillRect(0, 0, 8, 8); };
    const red = image('red', solid('#ff0000')), blue = image('blue', solid('#0000ff'));
    const pixel = (x = 4, y = 4) => { const b = new Uint8Array(4); r.gl.readPixels(x, y, 1, 1, r.gl.RGBA, r.gl.UNSIGNED_BYTE, b); return [...b]; };
    const render = (sources, params = master) => { r.render(sources, params); return pixel(); };
    const results = {};
    results.identity = render([red]);
    blue.values.opacity = .5; results.half = render([red, blue]);
    blue.values.opacity = 0; results.zero = render([red, blue]);
    blue.values.opacity = 1; results.full = render([red, blue]);
    results.reorder = render([blue, red]);
    const gray = image('gray', solid('#808080')), gray2 = image('gray2', solid('#808080'));
    results.screenGray = render([gray, gray2]); gray2.values.opacity = .5; results.screenHalfGray = render([gray, gray2]);
    results.blackOverlay = render([red, image('black', solid('#000000'))]);
    results.masterInvert = render([red], { ...master, inversion: 1 });
    results.masterFade = render([red], { ...master, opacity: .5 });
    red.values.red = 0; results.redGain = render([red]); red.values.red = 1;
    red.values.saturation = 0; results.gray = render([red]); red.values.saturation = 1;
    red.values.brightness = -.5; results.brightness = render([red]); red.values.brightness = 0;
    red.values.contrast = 0; results.contrast = render([red]); red.values.contrast = 1;
    red.values.hue = 180; results.hue = render([red]); red.values.hue = 0;
    const pattern = image('pattern', ctx => { ctx.fillStyle = 'red'; ctx.fillRect(0,0,4,4); ctx.fillStyle = 'lime'; ctx.fillRect(4,0,4,4); ctx.fillStyle = 'blue'; ctx.fillRect(0,4,4,4); ctx.fillStyle = 'white'; ctx.fillRect(4,4,4,4); });
    r.render([pattern], master); results.topLeft = pixel(1,6); results.bottomLeft = pixel(1,1);
    pattern.values.mirrorX = 2; pattern.values.mirrorY = 2; r.render([pattern], master); results.cloneLeft = pixel(0,7); results.cloneNext = pixel(4,7); results.cloneRight = pixel(3,7); results.cloneRightNext = pixel(7,7); results.cloneBottom = pixel(0,3);
    pattern.values.mirrorX = pattern.values.mirrorY = 1; pattern.values.pixelation = 8; r.render([pattern], master); results.pixelA = pixel(1,1); results.pixelB = pixel(6,6);
    r.render([red], { ...master, inversion: 1 }, { editing: true, points: [[.25,.25],[.75,.25],[.75,.75],[.25,.75]] });
    results.mappedCenter = pixel(4,4); results.mappedOutside = pixel(0,0);
    pattern.values.pixelation = 1;
    r.render([pattern], master, { editing: true, points: [[0,0],[1,0],[1,1],[0,1]] }); results.mappedIdentity = pixel(1,6);
    r.render([red], master, { editing: false, points: [[.25,.25],[.75,.25],[.75,.75],[.25,.75]] }); results.retainedMapping = pixel(0,0);
    r.remove(red.id); results.textureRemoved = !r.textures.has(red.id);
    results.glError = r.gl.getError();
    const ext = r.gl.getExtension('WEBGL_lose_context');
    if (ext) {
      await new Promise(resolve => { output.addEventListener('webglcontextlost', resolve, { once: true }); ext.loseContext(); });
      await new Promise(resolve => { output.addEventListener('webglcontextrestored', resolve, { once: true }); setTimeout(() => ext.restoreContext(), 100); });
      results.restored = render([red]);
    }
    r.dispose(); return results;
  });
  const near = (actual, expected) => expected.forEach((v, i) => expect(Math.abs(actual[i] - v)).toBeLessThanOrEqual(2));
  near(checks.identity, [255,0,0,255]); near(checks.half, [255,0,128,255]); near(checks.zero, [255,0,0,255]); near(checks.full, [255,0,255,255]); near(checks.reorder, [255,0,255,255]);
  near(checks.screenGray, [192,192,192,255]); near(checks.screenHalfGray, [160,160,160,255]); near(checks.blackOverlay, [255,0,0,255]);
  near(checks.masterInvert, [0,255,255,255]); near(checks.masterFade, [128,0,0,255]); near(checks.redGain, [0,0,0,255]);
  near(checks.gray, [54,54,54,255]); near(checks.brightness, [128,0,0,255]); near(checks.contrast, [128,128,128,255]);
  expect(checks.hue[0]).toBeLessThan(3); expect(checks.hue[1]).toBeGreaterThan(100);
  near(checks.topLeft, [255,0,0,255]); near(checks.bottomLeft, [0,0,255,255]);
  near(checks.cloneLeft, [255,0,0,255]); near(checks.cloneLeft, checks.cloneNext); near(checks.cloneRight, [0,255,0,255]); near(checks.cloneRight, checks.cloneRightNext); near(checks.cloneLeft, checks.cloneBottom); near(checks.pixelA, checks.pixelB);
  near(checks.mappedCenter, [0,255,255,255]); near(checks.mappedOutside, [0,0,0,255]); near(checks.mappedIdentity, [255,0,0,255]); near(checks.retainedMapping, [0,0,0,255]);
  expect(checks.textureRemoved).toBe(true); expect(checks.glError).toBe(0); near(checks.restored, [255,0,0,255]);
});

test('two-file lifecycle, knob interactions, replacement, and clean output', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  const fixture = await clip(page);
  await page.locator('#file-input').setInputFiles([fixture, { ...fixture, name: 'second.webm' }, { ...fixture, name: 'third.webm' }]);
  await expect(page.locator('.source-row')).toHaveCount(3);
  await page.locator('.source-row').nth(2).getByRole('button', { name: 'Remove video', exact: true }).click();
  await expect(page.locator('.source-row')).toHaveCount(2);
  await expect(page.locator('.source-row').first().locator('small')).toContainText('PLAYING');
  await expect(page.locator('#empty-add')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Add videos', exact: true })).toHaveCount(1);
  const first = page.locator('.source-row').first(); const second = page.locator('.source-row').nth(1);
  await expect(first.locator('[role=slider]').first()).toHaveAttribute('aria-valuenow', '0');
  await expect(second.locator('[role=slider]').first()).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#resolution')).toHaveValue('1080');
  await setValue(first, 0, 100); await setValue(second, 0, 50);
  await expect(page.locator('#signal-label')).toHaveText('V SIGNAL');
  await page.screenshot({ path: testInfo.outputPath('mixer.png'), fullPage: true });
  await first.locator('.channel-select').click();
  const hue = first.locator('[data-parameter=hue] [role=slider]'); await hue.focus(); await hue.press('ArrowUp'); await expect(hue).toHaveAttribute('aria-valuenow', '1'); await hue.dblclick(); await expect(hue).toHaveAttribute('aria-valuenow', '0');
  const opacity = first.locator('[role=slider]').first(); await opacity.scrollIntoViewIfNeeded(); const bounds = await opacity.boundingBox(); await page.mouse.move(bounds.x + 20, bounds.y + 20); await page.mouse.down(); await page.mouse.move(bounds.x + 20, bounds.y + 60); await page.mouse.up(); await expect(opacity).toHaveAttribute('aria-valuenow', '0.75');
  await first.getByRole('button', { name: 'Pause video', exact: true }).click(); await expect(first.locator('small')).toContainText('PAUSED');
  await expect(first.getByRole('button', { name: 'Back-and-forth playback', exact: true })).toHaveCount(0);
  await first.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect(page.getByRole('button', { name: /Move layer (up|down)/ })).toHaveCount(0);
  const popupPromise = page.waitForEvent('popup'); await page.locator('#open-output').click(); const popup = await popupPromise;
  await expect.poll(() => popup.locator('video').evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2);
  expect(await popup.locator('video').evaluate(v => v.videoWidth)).toBe(1920);
  await page.locator('#resolution').selectOption('720');
  await expect.poll(() => popup.locator('video').evaluate(v => v.videoHeight)).toBe(720);
  await popup.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect.poll(() => popup.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await popup.close();
  const reopen = page.waitForEvent('popup'); await page.locator('#open-output').click(); const reopened = await reopen;
  await expect.poll(() => reopened.locator('video').evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2); await reopened.close();
  const row = page.locator('.source-row').first();
  await row.getByRole('button', { name: 'Eject / replace video', exact: true }).click(); await page.locator('#replace-input').setInputFiles({ ...fixture, name: 'replacement.webm' });
  await expect(row.locator('strong')).toHaveText('replacement.webm'); await expect(row.locator('[role=slider]').first()).toHaveAttribute('aria-valuenow', '0.75');
  await row.getByRole('button', { name: 'Reset source effects', exact: true }).click(); await expect(row.locator('[role=slider]').first()).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('.source-row').nth(1).locator('[role=slider]').first()).toHaveAttribute('aria-valuenow', '0.5');
  await page.locator('#reset-all').click(); await expect(row.locator('[role=slider]').first()).toHaveAttribute('aria-valuenow', '0'); await expect(page.locator('.master').locator('[role=slider]').first()).toHaveAttribute('aria-valuenow', '1');
  await row.getByRole('button', { name: 'Remove video', exact: true }).click(); await page.locator('.source-row').getByRole('button', { name: 'Remove video', exact: true }).click();
  await expect(page.locator('#empty-add')).toBeVisible(); await expect(page.locator('#empty-add')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('invalid video gives a recoverable error and compact layout remains usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'broken.webm', mimeType: 'video/webm', buffer: Buffer.from('not a video') });
  await expect(page.locator('.source-row small')).toHaveText('PLAYBACK ERROR');
  await expect(page.locator('.message').last()).toContainText('Try replacing');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.source-row').getByRole('button', { name: 'Remove video', exact: true }).click();
  await expect(page.locator('#empty-add')).toBeVisible();
});

test('software rendering benchmark: two 1080p clips at 720p output', async ({ page }, testInfo) => {
  await page.goto('/'); await page.locator('#resolution').selectOption('720'); const fixture = await clip(page, 1920, 1080);
  await page.locator('#file-input').setInputFiles([fixture, { ...fixture, name: 'second-1080p.webm' }]);
  await expect(page.locator('.source-row small').first()).toContainText('PLAYING');
  for (const row of await page.locator('.source-row').all()) { await setValue(row, 0, 50); await setValue(row, 8, 3); await setValue(row, 10, 45); }
  await page.waitForTimeout(1500);
  const fps = [];
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(1000); fps.push(Number(await page.locator('#fps').textContent())); }
  const popupPromise = page.waitForEvent('popup'); await page.locator('#open-output').click(); const popup = await popupPromise;
  await expect.poll(() => popup.locator('video').evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2);
  const withOutput = []; for (let i = 0; i < 3; i++) { await page.waitForTimeout(1000); withOutput.push(Number(await page.locator('#fps').textContent())); }
  await popup.close(); await page.locator('#resolution').selectOption('360');
  const light = []; for (let i = 0; i < 3; i++) { await page.waitForTimeout(1000); light.push(Number(await page.locator('#fps').textContent())); }
  const report = { light, renderer: await page.evaluate(() => { const gl = document.querySelector('#output').getContext('webgl2'); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }), fps, withOutput, decodeDrops: await page.locator('#dropped').textContent() };
  console.log('Performance:', JSON.stringify(report)); await testInfo.attach('performance', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  expect(fps.some(n => n > 0)).toBe(true); await popup.close();
});

test('compact grayscale layout and master mapping controls inside the table', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  const fixture = await clip(page);
  await page.locator('#file-input').setInputFiles(fixture);
  const row = page.locator('.source-row');
  await expect(row.locator('small')).toContainText('PLAYING');
  await expect(page.locator('#empty-add')).toBeEnabled();
  await setValue(row, 0, 100);
  const matrix = await page.locator('.mixer-section').boundingBox(), monitor = await page.locator('.monitor-section').boundingBox();
  expect(monitor.x).toBeGreaterThan(matrix.x + matrix.width);
  expect(monitor.width / 1440).toBeGreaterThan(.17); expect(monitor.width / 1440).toBeLessThan(.23);
  await expect(page.locator('.master-symbol')).toHaveCount(0);
  await expect(page.locator('.add-row')).toHaveCount(0);
  await expect(page.locator('.source-column-label').getByRole('button', { name: 'Add videos', exact: true })).toHaveText('+');
  await expect(page.locator('#reset-all')).toHaveText('RESET');
  expect(await page.evaluate(() => Number(getComputedStyle(document.documentElement).zoom))).toBe(1.4);
  await expect(page.locator('label[for=resolution]')).toContainText('RESOLUTION');
  const color = await page.locator('.channel-effects:not([hidden]) .effect-group').first().evaluate(el => getComputedStyle(el).borderColor);
  const rgb = color.match(/\d+/g).map(Number); expect(rgb[0]).toBeGreaterThan(rgb[1]); expect(rgb[1]).toBe(rgb[2]); expect(rgb[0] - rgb[1]).toBeLessThan(60);
  const master = page.locator('.master'); await master.locator('.channel-select').click();
  await expect(master.locator('.group-mapping')).toBeVisible();
  await expect(page.locator('.monitor-section .group-mapping')).toHaveCount(0);
  await expect(page.locator('.mapping-handle')).toHaveCount(0);
  const setMap = async (key, value) => { const input = master.locator(`[data-parameter=${key}] input`); await input.fill(String(value)); await input.press('Enter'); };
  await setMap('mapX1', 18); await setMap('mapY1', 20);
  await page.screenshot({ path: testInfo.outputPath('mapping.png'), fullPage: true });
  const popupPromise = page.waitForEvent('popup'); await page.locator('#open-output').click(); const popup = await popupPromise;
  await expect.poll(() => popup.locator('video').evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => popup.locator('video').evaluate(video => {
    const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
    const ctx = c.getContext('2d'); ctx.drawImage(video, 0, 0);
    const outside = ctx.getImageData(2,2,1,1).data, center = ctx.getImageData(c.width/2,c.height/2,1,1).data;
    return [...outside].slice(0,3).every(v => v < 5) && [...center].slice(0,3).some(v => v > 30);
  })).toBe(true);
  await expect(popup.locator('.mapping-handle')).toHaveCount(0);
  await popup.close();
  await master.locator('.mapping-reset').click();
  await expect(master.locator('[data-parameter=mapX1] .knob')).toHaveAttribute('aria-valuenow', '0');
  await expect(master.locator('[data-parameter=mapY1] .knob')).toHaveAttribute('aria-valuenow', '0');
  await setMap('mapX1', 10); await page.locator('#reset-all').click();
  await expect(master.locator('[data-parameter=mapX1] .knob')).toHaveAttribute('aria-valuenow', '0');
  await expect(row.locator('[role=slider]').first()).toHaveAttribute('aria-valuenow', '0');
  expect(errors).toEqual([]);
});

test('fullscreen output keeps moving when the mixer window clocks are suspended', async ({ page }) => {
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window), interval = window.setInterval.bind(window);
    window.requestAnimationFrame = callback => raf(now => { if (!window.suspendMixerClocks) callback(now); });
    window.setInterval = (callback, delay, ...args) => interval(() => { if (!window.suspendMixerClocks) callback(...args); }, delay);
    const videoFrame = HTMLVideoElement.prototype.requestVideoFrameCallback;
    if (videoFrame) HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
      return videoFrame.call(this, (...args) => { if (!window.suspendMixerClocks) callback(...args); });
    };
  });
  await page.goto('/'); const fixture = await clip(page);
  await page.locator('#file-input').setInputFiles(fixture); await expect(page.locator('.source-row small')).toContainText('PLAYING');
  await setValue(page.locator('.source-row'), 0, 100);
  const popupPromise = page.waitForEvent('popup'); await page.locator('#open-output').click(); const popup = await popupPromise;
  await expect.poll(() => popup.locator('video').evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2);
  await popup.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect.poll(() => popup.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.evaluate(() => { window.suspendMixerClocks = true; Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
  // Sample changing pixels, rather than media time (which can advance on a frozen picture).
  const hashes = await popup.evaluate(async () => {
    const video = document.querySelector('video'), c = document.createElement('canvas'); c.width = 64; c.height = 36;
    const ctx = c.getContext('2d', { willReadFrequently: true }), hashes = [];
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 100)); ctx.drawImage(video, 0, 0, 64, 36);
      let hash = 2166136261; for (const v of ctx.getImageData(0, 0, 64, 36).data) hash = Math.imul(hash ^ v, 16777619);
      hashes.push(hash >>> 0);
    }
    return hashes;
  });
  expect(new Set(hashes).size).toBeGreaterThan(2);
  await popup.close();
});

test('centered preview eyes, master controls and replacement through eject', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); const fixture = await clip(page);
  await expect(page.locator('#signal-label')).toHaveText('X SIGNAL');
  await expect(page.locator('.signal-controls #reset-all')).toHaveText('RESET');
  await expect(page.locator('.source-column-label #source-count')).toHaveText('0');
  await expect(page.locator('.matrix-toolbar')).toHaveCount(0);
  await page.locator('#file-input').setInputFiles([fixture, { ...fixture, name: 'second.webm' }]);
  const first = page.locator('.source-row').first(), second = page.locator('.source-row').nth(1), master = page.locator('.master');
  await expect(first.locator('small')).toContainText('PLAYING'); await expect(second.locator('small')).toContainText('PLAYING');
  await expect(page.locator('.source-column-label #source-count')).toHaveText('2');
  await expect(master.locator('.channel-select')).toHaveText('MASTER');
  await expect(first.getByRole('button', { name: 'Source preview', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(first.locator('video')).toBeHidden();
  await first.getByRole('button', { name: 'Source preview', exact: true }).click(); await expect(first.locator('video')).toBeVisible();
  await expect(page.locator('.source-row video')).toHaveCount(2);
  await first.getByRole('button', { name: 'Source preview', exact: true }).click(); await expect(first.locator('video')).toBeHidden();
  const sourceReset = await first.getByRole('button', { name: 'Reset source effects', exact: true }).boundingBox();
  const masterReset = await master.getByRole('button', { name: 'Reset master effects', exact: true }).boundingBox();
  expect(sourceReset.width).toBeCloseTo(masterReset.width, 0); expect(sourceReset.height).toBeCloseTo(masterReset.height, 0); expect(sourceReset.x).toBeCloseTo(masterReset.x, 0);
  await second.getByRole('button', { name: 'Pause video', exact: true }).click();
  await master.getByRole('button', { name: 'Pause all sources', exact: true }).click();
  const times = await page.locator('.source-row video').evaluateAll(videos => videos.map(v => v.currentTime));
  await page.waitForTimeout(200);
  const pausedTimes = await page.locator('.source-row video').evaluateAll(videos => videos.map(v => v.currentTime));
  times.forEach((time, i) => expect(Math.abs(pausedTimes[i] - time)).toBeLessThan(.02));
  await master.getByRole('button', { name: 'Resume all sources', exact: true }).click();
  await expect(first.locator('small')).toContainText('PLAYING'); await expect(second.locator('small')).toContainText('PAUSED');
  await expect(first.getByRole('button', { name: 'Back-and-forth playback', exact: true })).toHaveCount(0);
  expect(await first.locator('video').evaluate(v => v.loop)).toBe(true);
  for (const [row, label] of [[first, 'Source preview'], [master, 'Master monitor']]) {
    await expect(row.locator('.thumbnail').getByRole('button')).toHaveCount(1);
    const tile = await row.locator('.thumbnail').boundingBox();
    const eye = await row.getByRole('button', { name: label, exact: true }).locator('svg').boundingBox();
    expect(Math.abs((eye.x + eye.width / 2) - (tile.x + tile.width / 2))).toBeLessThan(1);
    expect(Math.abs((eye.y + eye.height / 2) - (tile.y + tile.height / 2))).toBeLessThan(1);
  }
  await setValue(first, 0, 80);
  await first.getByRole('button', { name: 'Source preview', exact: true }).click();
  const originalId = await first.getAttribute('data-source');
  const cancelPicker = page.waitForEvent('filechooser'); await first.getByRole('button', { name: 'Eject / replace video', exact: true }).click();
  await (await cancelPicker).setFiles([]);
  await expect(page.locator('.source-row')).toHaveCount(2); await expect(first.locator('strong')).toHaveText('test-pattern.webm');
  expect(await first.getAttribute('data-source')).toBe(originalId);
  const replacePicker = page.waitForEvent('filechooser'); await first.getByRole('button', { name: 'Eject / replace video', exact: true }).click();
  await (await replacePicker).setFiles({ ...fixture, name: 'replacement-through-eject.webm' });
  await expect(first.locator('strong')).toHaveText('replacement-through-eject.webm'); await expect(first.locator('small')).toContainText('PLAYING');
  await expect(page.locator('.source-row')).toHaveCount(2); await expect(page.locator('#source-count')).toHaveText('2');
  await expect(first.locator('[role=slider]').first()).toHaveAttribute('aria-valuenow', '0.8');
  await expect(first.getByRole('button', { name: 'Source preview', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(first.locator('video')).toBeVisible();
  await setValue(first, 0, 100);
  const popupPromise = page.waitForEvent('popup'); await page.locator('#open-output').click(); const popup = await popupPromise;
  await expect.poll(() => popup.locator('video').evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2);
  await master.getByRole('button', { name: 'Master monitor', exact: true }).click();
  await expect(page.locator('#output')).toHaveCSS('visibility', 'hidden');
  const before = await popup.locator('video').evaluate(v => v.getVideoPlaybackQuality().totalVideoFrames);
  await expect.poll(() => popup.locator('video').evaluate(v => v.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(before + 1);
  await master.getByRole('button', { name: 'Master monitor', exact: true }).click(); await expect(page.locator('#output')).toHaveCSS('visibility', 'visible');
  await popup.close();
  await page.screenshot({ path: testInfo.outputPath('transport.png'), fullPage: true });
  await first.getByRole('button', { name: 'Remove video', exact: true }).click(); await expect(page.locator('.source-row')).toHaveCount(1);
  await expect(page.locator('.source-column-label #source-count')).toHaveText('1');
  await page.locator('.source-row').getByRole('button', { name: 'Remove video', exact: true }).click(); await expect(page.locator('#signal-label')).toHaveText('X SIGNAL');
  expect(errors).toEqual([]);
});

test('Ctrl+arrows navigate channel controls and knobs without changing their values', async ({ page }, testInfo) => {
  await page.goto('/'); const fixture = await clip(page);
  await page.locator('#file-input').setInputFiles([fixture, { ...fixture, name: 'second.webm' }]);
  const first = page.locator('.source-row').first(), second = page.locator('.source-row').nth(1), master = page.locator('.master');
  await expect(first.locator('small')).toContainText('PLAYING');
  await expect(page.getByRole('button', { name: /Move layer (up|down)/ })).toHaveCount(0);
  const move = key => page.keyboard.press(`Control+${key}`);
  await move('ArrowRight'); await expect(first.locator('[role=slider]').nth(0)).toBeFocused();
  await expect(first.locator('[role=slider]').nth(0)).toHaveClass(/control-selected/);
  await move('ArrowRight'); await expect(first.locator('[role=slider]').nth(1)).toBeFocused();
  await expect(first.locator('[role=slider]').nth(0)).toHaveAttribute('aria-valuenow', '0');
  await expect(first.locator('[role=slider]').nth(1)).toHaveAttribute('aria-valuenow', '1');
  await move('ArrowDown'); await expect(second.locator('[role=slider]').nth(1)).toBeFocused();
  await move('ArrowDown'); await expect(master.locator('[role=slider]').nth(1)).toBeFocused();
  await move('ArrowDown'); await expect(master.locator('[role=slider]').nth(1)).toBeFocused();
  await move('ArrowUp'); await expect(second.locator('[role=slider]').nth(1)).toBeFocused();
  await move('ArrowLeft'); await expect(second.locator('[role=slider]').nth(0)).toBeFocused();
  for (const label of ['Remove video', 'Random position', 'Forward 5 seconds', 'Back 5 seconds', 'Reset source effects', 'Eject / replace video', 'Pause video', 'Select source 2', 'Source preview']) {
    await move('ArrowLeft'); await expect(second.getByRole('button', { name: label, exact: true })).toBeFocused();
  }
  await move('ArrowLeft'); await expect(second.getByRole('button', { name: 'Source preview', exact: true })).toBeFocused();
  await move('ArrowUp'); await expect(first.getByRole('button', { name: 'Source preview', exact: true })).toBeFocused();
  await move('ArrowUp'); await expect(first.getByRole('button', { name: 'Source preview', exact: true })).toBeFocused();
  // A missing master eject falls back to play; returning up restores the eject column.
  await second.getByRole('button', { name: 'Eject / replace video', exact: true }).focus();
  await move('ArrowDown'); await expect(master.getByRole('button', { name: 'Pause all sources', exact: true })).toBeFocused();
  await move('ArrowUp'); await expect(second.getByRole('button', { name: 'Eject / replace video', exact: true })).toBeFocused();
  await second.locator('[role=slider]').nth(0).focus();
  for (let i = 0; i < 27; i++) await move('ArrowRight');
  const last = second.locator('[role=slider]').last(); await expect(last).toBeFocused();
  expect(await last.evaluate(el => { const b = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); })).toBe(true);
  await expect(page.locator('.control-selected')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('keyboard-selection.png'), fullPage: true });
  await move('ArrowRight'); await expect(second.locator('.mapping-reset')).toBeFocused();
  await move('ArrowLeft'); await expect(last).toBeFocused();
  // Mouse selection and plain arrow adjustment remain available.
  await second.locator('[role=slider]').nth(1).click(); await expect(second.locator('[role=slider]').nth(1)).toHaveClass(/control-selected/);
  await page.keyboard.press('ArrowUp'); await expect(second.locator('[role=slider]').nth(1)).toHaveAttribute('aria-valuenow', '1.05');
  const number = second.locator('.knob-value').nth(1); await number.fill('0.42');
  await move('ArrowLeft'); await expect(number).toBeFocused(); await number.press('Enter');
  await expect(second.locator('[role=slider]').nth(1)).toHaveAttribute('aria-valuenow', '0.42');
  await expect(second.locator('[role=slider]').nth(1)).toBeFocused();
});

test('Ctrl navigation skips disabled controls and recovers after removing a source', async ({ page }) => {
  await page.goto('/'); const fixture = await clip(page);
  await page.locator('#file-input').setInputFiles([fixture, { ...fixture, name: 'second.webm' }]);
  const first = page.locator('.source-row').first(), second = page.locator('.source-row').nth(1), master = page.locator('.master');
  await expect(first.locator('small')).toContainText('PLAYING');
  await master.getByRole('button', { name: 'Pause all sources', exact: true }).click();
  await expect(second.getByRole('button', { name: 'Play video', exact: true })).toBeDisabled();
  await second.getByRole('button', { name: 'Eject / replace video', exact: true }).focus();
  await page.keyboard.press('Control+ArrowLeft'); await expect(second.locator('.channel-select')).toBeFocused();
  await first.getByRole('button', { name: 'Remove video', exact: true }).focus();
  await page.keyboard.press('Enter'); await expect(page.locator('.source-row')).toHaveCount(1);
  const remaining = page.locator('.source-row');
  await expect(remaining.getByRole('button', { name: 'Remove video', exact: true })).toBeFocused();
  await page.keyboard.press('Control+ArrowRight'); await expect(remaining.locator('[role=slider]').first()).toBeFocused();
  await page.keyboard.press('Control+ArrowDown'); await expect(master.locator('[role=slider]').first()).toBeFocused();
  await remaining.getByRole('button', { name: 'Remove video', exact: true }).click();
  await expect(page.locator('.source-row')).toHaveCount(0); await expect(master.getByRole('button', { name: 'Reset master effects', exact: true })).toBeFocused();
  await page.keyboard.press('Control+ArrowRight'); await expect(master.locator('[role=slider]').first()).toBeFocused();
  await page.locator('#resolution').focus(); await page.keyboard.press('Control+ArrowLeft'); await expect(page.locator('#resolution')).toBeFocused();
});

test('selected channel workspace groups effects and retains each channel state', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const fixture = await clip(page);
  await page.locator('#file-input').setInputFiles([{ ...fixture, name: 'metropolis.webm' }, { ...fixture, name: 'nosferatu.webm' }]);
  const first = page.locator('.source-row').first(), second = page.locator('.source-row').nth(1);
  await expect(first.locator('small')).toContainText('PLAYING');
  await expect(first.locator('.channel-select')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.channel-effects:visible')).toHaveCount(1);
  await expect(page.locator('#channel-title')).toHaveCount(0);
  const panelBounds = await first.locator('.channel-effects').boundingBox(), monitorBounds = await page.locator('.monitor-section').boundingBox(), listBounds = await page.locator('.source-column-label').boundingBox();
  expect(panelBounds.y).toBeCloseTo(monitorBounds.y, 0); expect(panelBounds.y).toBeCloseTo(listBounds.y, 0);
  await expect(first.locator('.effect-group h2')).toHaveText(['👻 OPACITY', '🔴🟢🔵 RGB', '🎨 COLORS', '🧪 FX', '🧲 RGB SHIFT', '🎡 SLIDE', '⚡ EDGE', /🗺️ MAPPING/]);
  await setValue(first, 0, 65); await setValue(first, 3, 1.2);
  await setValue(second, 0, 35); await setValue(second, 10, 30);
  await first.locator('.channel-select').click();
  await expect(first.locator('[data-parameter=contrast] .knob')).toHaveAttribute('aria-valuenow', '1.2');
  await first.locator('[data-parameter=hue] .knob').focus();
  await page.keyboard.press('Control+ArrowDown');
  await expect(second.locator('.channel-select')).toHaveAttribute('aria-pressed', 'true');
  await expect(second.locator('[data-parameter=hue] .knob')).toBeFocused();
  await expect(second.locator('[data-parameter=hue] .knob')).toHaveAttribute('aria-valuenow', '30');
  await page.keyboard.press('Control+ArrowDown');
  await expect(page.locator('.master .channel-select')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.channel-effects:visible')).toHaveCount(1);
  await first.locator('.channel-select').click();
  await expect(first.locator('.channel-select')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('channel-workspace.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('RGB shifts separate each component on both axes; slide leaves empty edges in sources and master', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer.js'), { defaults } = await import('/src/parameters.js');
    const output = document.createElement('canvas'); output.width = output.height = 8;
    const r = new Renderer(output);
    const source = (id, color) => {
      const c = document.createElement('canvas'); c.width = c.height = 8; const ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 8, 8);
      Object.defineProperties(c, { videoWidth: { value: 8 }, videoHeight: { value: 8 }, readyState: { value: 4 } });
      return { id, video: c, values: { ...defaults(), opacity: 1 }, dirty: true };
    };
    const white = source('white', 'white'), red = source('red', 'red'), blue = source('blue', 'blue'), master = defaults(true);
    const pixel = (x, y) => { const data = new Uint8Array(4); r.gl.readPixels(x, 7 - y, 1, 1, r.gl.RGBA, r.gl.UNSIGNED_BYTE, data); return [...data]; };
    const shifts = {};
    for (const key of ['redX', 'redY', 'greenX', 'greenY', 'blueX', 'blueY']) {
      for (const sign of [-1, 1]) {
        white.values[key] = sign * .5; r.render([white], master);
        const x = key.endsWith('X') ? sign > 0 ? 1 : 6 : 3, y = key.endsWith('Y') ? sign > 0 ? 1 : 6 : 3;
        shifts[key + sign] = pixel(x, y); white.values[key] = 0;
      }
    }
    const slides = {};
    for (const key of ['slideX', 'slideY']) {
      for (const sign of [-1, 1]) {
        white.values[key] = sign * .5; r.render([white], master);
        const x = key.endsWith('X') ? sign > 0 ? 1 : 6 : 3, y = key.endsWith('Y') ? sign > 0 ? 1 : 6 : 3;
        slides[key + sign] = { empty: pixel(x, y), filled: pixel(7 - x, 7 - y) }; white.values[key] = 0;
      }
    }
    blue.values.slideX = .5; r.render([red, blue], master); const underlying = pixel(1, 3), overlay = pixel(6, 3);
    r.render([white], { ...master, slideX: .5, inversion: 1 }); const masterEmpty = pixel(1, 3), masterInvert = pixel(6, 3);
    r.render([white], { ...master, redY: .5 }); const masterShift = pixel(3, 1);
    const neutral = r.isNeutral(master), shiftedNeutral = r.isNeutral({ ...master, redX: .1 });
    const error = r.gl.getError(); r.dispose(); return { shifts, slides, underlying, overlay, masterEmpty, masterInvert, masterShift, neutral, shiftedNeutral, error };
  });
  for (const [key, pixel] of Object.entries(results.shifts)) {
    const expected = key.startsWith('red') ? [0,255,255,255] : key.startsWith('green') ? [255,0,255,255] : [255,255,0,255];
    expect(pixel).toEqual(expected);
  }
  for (const result of Object.values(results.slides)) { expect(result.empty).toEqual([0,0,0,255]); expect(result.filled).toEqual([255,255,255,255]); }
  expect(results.underlying).toEqual([255,0,0,255]); expect(results.overlay).toEqual([255,0,255,255]);
  expect(results.masterEmpty).toEqual([0,0,0,255]); expect(results.masterInvert).toEqual([0,0,0,255]); expect(results.masterShift).toEqual([0,255,255,255]);
  expect(results.neutral).toBe(true); expect(results.shiftedNeutral).toBe(false); expect(results.error).toBe(0);
});

test('telemetry displays system readings and handles unavailable counters', async ({ page }) => {
  await page.route('**/api/telemetry', route => route.fulfill({ json: { cpu: 27.3, gpu: null, memoryUsed: 2 ** 31, memoryTotal: 2 ** 33 } }));
  await page.goto('/');
  await expect(page.locator('#cpu-load')).toHaveText('27%'); await expect(page.locator('#gpu-load')).toHaveText('—');
  await expect(page.locator('#memory-use')).toHaveText('2.0 / 8.0 GiB');
  await page.route('**/api/telemetry', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await expect(page.locator('#cpu-load')).toHaveText('—'); await expect(page.locator('#memory-use')).toHaveText('—');
});

test('rotation turns rectangular frames clockwise without stretching or wrapping and resets per channel', async ({ page }) => {
  await page.goto('/');
  const pixels = await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer.js'), { defaults } = await import('/src/parameters.js');
    const output = document.createElement('canvas'); output.width = 16; output.height = 8; const r = new Renderer(output);
    const image = document.createElement('canvas'); image.width = 16; image.height = 8; const ctx = image.getContext('2d');
    for (const [color, x, y] of [['red',0,0], ['lime',8,0], ['blue',0,4], ['white',8,4]]) { ctx.fillStyle = color; ctx.fillRect(x,y,8,4); }
    Object.defineProperties(image, { videoWidth: { value: 16 }, videoHeight: { value: 8 }, readyState: { value: 4 } });
    const source = { id: 'pattern', video: image, values: { ...defaults(), opacity: 1 }, dirty: true }, master = defaults(true);
    const pixel = (x,y) => { const bytes = new Uint8Array(4); r.gl.readPixels(x,7-y,1,1,r.gl.RGBA,r.gl.UNSIGNED_BYTE,bytes); return [...bytes]; };
    source.values.rotation = 90; r.render([source], master);
    const quarter = { inside: pixel(5,1), outside: pixel(1,1) };
    source.values.rotation = 180; r.render([source], master); const half = pixel(1,1);
    source.values.rotation = 360; r.render([source], master); const full = pixel(1,1);
    source.values.rotation = 0; r.render([source], { ...master, rotation: 90 }); const masterQuarter = pixel(5,1), masterOutside = pixel(1,1);
    const neutral = r.isNeutral({ ...master, rotation: 360 }), nonNeutral = r.isNeutral({ ...master, rotation: 90 });
    r.dispose(); return { quarter, half, full, masterQuarter, masterOutside, neutral, nonNeutral };
  });
  expect(pixels.quarter.inside).toEqual([0,0,255,255]); expect(pixels.quarter.outside).toEqual([0,0,0,255]);
  expect(pixels.half).toEqual([255,255,255,255]); expect(pixels.full).toEqual([255,0,0,255]);
  expect(pixels.masterQuarter).toEqual([0,0,255,255]); expect(pixels.masterOutside).toEqual([0,0,0,255]);
  expect(pixels.neutral).toBe(true); expect(pixels.nonNeutral).toBe(false);
  await page.locator('#file-input').setInputFiles(await clip(page));
  const row = page.locator('.source-row'), rotation = row.locator('[data-parameter=rotation] .knob');
  await expect(rotation).toHaveAttribute('aria-valuenow', '0');
  const input = row.locator('[data-parameter=rotation] input'); await input.fill('90'); await input.press('Enter');
  await expect(rotation).toHaveAttribute('aria-valuenow', '90');
  await row.getByRole('button', { name: 'Reset source effects', exact: true }).click(); await expect(rotation).toHaveAttribute('aria-valuenow', '0');
  await page.locator('.master .channel-select').click();
  const masterRotation = page.locator('.master [data-parameter=rotation] .knob');
  await masterRotation.focus(); await masterRotation.press('End'); await expect(masterRotation).toHaveAttribute('aria-valuenow', '360');
  await page.locator('#reset-all').click(); await expect(masterRotation).toHaveAttribute('aria-valuenow', '0');
});

test('EDGE detects contours, controls threshold and width, blends, resets and combines with RGB shift', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer.js'), { defaults } = await import('/src/parameters.js');
    const output = document.createElement('canvas'); output.width = output.height = 16; const r = new Renderer(output);
    const image = document.createElement('canvas'); image.width = image.height = 16; const ctx = image.getContext('2d');
    ctx.fillStyle = 'black'; ctx.fillRect(0,0,16,16); ctx.fillStyle = 'white'; ctx.fillRect(8,0,8,16);
    Object.defineProperties(image, { videoWidth: { value: 16 }, videoHeight: { value: 16 }, readyState: { value: 4 } });
    const values = { ...defaults(), opacity: 1 }, source = { id: 'step', video: image, values, dirty: true }, master = defaults(true);
    const pixel = (x,y = 8) => { const b = new Uint8Array(4); r.gl.readPixels(x,y,1,1,r.gl.RGBA,r.gl.UNSIGNED_BYTE,b); return [...b]; };
    r.render([source], master); const original = pixel(13);
    values.edgeThreshold = 1; values.edgeWidth = 8; r.render([source], master); const disabled = pixel(13);
    values.edgeAmount = 1; values.edgeThreshold = .1; values.edgeWidth = 1; r.render([source], master);
    const edge = pixel(7), flat = pixel(13), thin = pixel(5);
    values.edgeWidth = 3; r.render([source], master); const thick = pixel(5);
    values.edgeThreshold = 1; r.render([source], master); const suppressed = pixel(7);
    values.edgeThreshold = .1; values.edgeAmount = .5; r.render([source], master); const blended = pixel(11);
    values.edgeAmount = 1; values.edgeWidth = 1; values.redX = .125; r.render([source], master); const combined = pixel(7);
    values.edgeAmount = 0; values.redX = 0; r.render([source], { ...master, edgeAmount: 1 }); const masterEdge = pixel(7), masterFlat = pixel(13);
    const neutral = r.isNeutral({ ...master, edgeThreshold: 1, edgeWidth: 8 }), nonNeutral = r.isNeutral({ ...master, edgeAmount: .1 });
    const glError = r.gl.getError(); r.dispose(); return { original, disabled, edge, flat, thin, thick, suppressed, blended, combined, masterEdge, masterFlat, neutral, nonNeutral, glError };
  });
  const white = [255,255,255,255], black = [0,0,0,255];
  for (const key of ['original', 'disabled', 'edge', 'thick', 'combined', 'masterEdge']) expect(result[key]).toEqual(white);
  for (const key of ['flat', 'thin', 'suppressed', 'masterFlat']) expect(result[key]).toEqual(black);
  expect(result.blended[0]).toBeGreaterThanOrEqual(127); expect(result.blended[0]).toBeLessThanOrEqual(128);
  expect(result.neutral).toBe(true); expect(result.nonNeutral).toBe(false); expect(result.glError).toBe(0);
  await page.locator('#file-input').setInputFiles(await clip(page));
  const row = page.locator('.source-row'), amount = row.locator('[data-parameter=edgeAmount] .knob');
  await expect(amount).toHaveAttribute('aria-valuenow', '0');
  const input = row.locator('[data-parameter=edgeAmount] input'); await input.fill('100'); await input.press('Enter');
  await row.getByRole('button', { name: 'Reset source effects', exact: true }).click(); await expect(amount).toHaveAttribute('aria-valuenow', '0');
  await page.locator('.master .channel-select').click();
  const masterInput = page.locator('.master [data-parameter=edgeAmount] input'); await masterInput.fill('100'); await masterInput.press('Enter');
  await page.locator('#reset-all').click(); await expect(page.locator('.master [data-parameter=edgeAmount] .knob')).toHaveAttribute('aria-valuenow', '0');
});

test('EDGE software performance with two videos, including RGB shift', async ({ page }, testInfo) => {
  await page.goto('/'); await page.locator('#resolution').selectOption('720'); const fixture = await clip(page, 640, 360);
  await page.locator('#file-input').setInputFiles([fixture, { ...fixture, name: 'second.webm' }]);
  const first = page.locator('.source-row').first(), second = page.locator('.source-row').nth(1);
  await expect(first.locator('small')).toContainText('PLAYING'); await setValue(first, 0, 70); await setValue(second, 0, 40);
  async function value(key, text) {
    await first.locator('.channel-select').click(); const input = first.locator(`[data-parameter=${key}] input`); await input.fill(text); await input.press('Enter');
  }
  const fps = async () => { await page.waitForTimeout(1200); const readings = []; for (let i = 0; i < 2; i++) { await page.waitForTimeout(1100); readings.push(Number(await page.locator('#fps').textContent())); } return readings; };
  const baseline = await fps(); await value('edgeAmount', '100'); const edge = await fps();
  await value('redX', '2'); await value('blueY', '-2'); const combined = await fps();
  await page.locator('#resolution').selectOption('360'); const combined360 = await fps();
  const report = { baseline720: baseline, edge720: edge, edgeAndRGBShift720: combined, edgeAndRGBShift360: combined360, note: 'Two 640x360 VP8 clips; EDGE and RGB SHIFT on first source, software Chromium; short headless samples.' };
  console.log('EDGE performance:', JSON.stringify(report)); await testInfo.attach('edge-performance', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  expect([...baseline, ...edge, ...combined, ...combined360].every(Number.isFinite)).toBe(true); expect(edge.some(f => f > 0)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('edge-workspace.png'), fullPage: true });
});

test('1080p is the default and six sources stay selectable, replaceable and aligned', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#resolution')).toHaveValue('1080');
  expect(await page.locator('#output').evaluate(c => [c.width, c.height])).toEqual([1920,1080]);
  const fixture = await clip(page);
  const files = Array.from({ length: 6 }, (_, i) => ({ ...fixture, name: `channel-${i + 1}.webm` }));
  await page.locator('#file-input').setInputFiles(files.slice(0,4));
  await expect(page.locator('.source-row')).toHaveCount(4);
  await expect(page.locator('#empty-add')).toBeEnabled();
  await page.locator('#file-input').setInputFiles(files.slice(4));
  await expect(page.locator('.source-row')).toHaveCount(6); await expect(page.locator('#source-count')).toHaveText('6');
  const cells = page.locator('.source-cell');
  const bounds = await cells.evaluateAll(elements => elements.map(el => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; }));
  expect(bounds).toHaveLength(7);
  for (let i = 1; i < bounds.length; i++) expect(bounds[i].top).toBeGreaterThanOrEqual(bounds[i-1].bottom - 1);
  for (const row of await page.locator('.source-row').all()) {
    await expect(row.locator('small')).toContainText('PLAYING'); await setValue(row, 0, 10);
  }
  const uploaded = await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer.js');
    return new Promise(resolve => {
      const original = Renderer.prototype.render;
      Renderer.prototype.render = function (...args) {
        const result = original.apply(this, args); Renderer.prototype.render = original;
        resolve(args[0].filter(source => this.textures.has(source.id)).length); return result;
      };
    });
  });
  expect(uploaded).toBe(6);
  const last = page.locator('.source-row').last();
  await last.locator('.channel-select').click(); await expect(last.locator('.channel-effects')).toBeVisible();
  await expect(page.locator('.channel-effects:visible')).toHaveCount(1);
  const input = last.locator('[data-parameter=contrast] input'); await input.fill('1.5'); await input.press('Enter');
  await last.getByRole('button', { name: 'Eject / replace video', exact: true }).click();
  await page.locator('#replace-input').setInputFiles({ ...fixture, name: 'sixth-replaced.webm' });
  await expect(last.locator('strong')).toHaveText('sixth-replaced.webm');
  await expect(last.locator('[data-parameter=contrast] .knob')).toHaveAttribute('aria-valuenow', '1.5');
  await last.locator('[data-parameter=contrast] .knob').focus(); await page.keyboard.press('Control+ArrowDown');
  await expect(page.locator('.master [data-parameter=contrast] .knob')).toBeFocused();
  await page.locator('.source-row').nth(2).getByRole('button', { name: 'Remove video', exact: true }).click();
  await expect(page.locator('.source-row')).toHaveCount(5); await expect(page.locator('#source-count')).toHaveText('5');
  await page.screenshot({ path: testInfo.outputPath('multiple-sources.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#empty-add')).toBeEnabled(); expect(errors).toEqual([]);
});

test('themes change dashboard colors, preserve the mix, persist and recover from unknown saved values', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.locator('#theme')).toHaveValue('classic');
  await expect(page.locator('#theme option')).toHaveText(['CLASSIC', 'DARK', 'SUNSET', 'TROPICANA']);
  await page.locator('#file-input').setInputFiles(await clip(page));
  const row = page.locator('.source-row'); await expect(row.locator('small')).toContainText('PLAYING');
  await setValue(row, 0, 65); await setValue(row, 3, 1.5);
  await row.getByRole('button', { name: 'Pause video', exact: true }).click();
  const before = await row.locator('.knob').evaluateAll(controls => controls.map(el => el.getAttribute('aria-valuenow')));
  const originalVideo = await row.locator('video').evaluate(video => ({ src: video.src, time: video.currentTime }));
  const palettes = [];
  for (const theme of ['classic', 'dark', 'sunset', 'tropicana']) {
    await page.locator('#theme').selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    palettes.push(await page.locator('.effect-group').first().evaluate(el => getComputedStyle(el).backgroundColor));
    expect(await row.locator('.knob').evaluateAll(controls => controls.map(el => el.getAttribute('aria-valuenow')))).toEqual(before);
    expect(await row.locator('video').evaluate(v => ({ src: v.src, time: v.currentTime, paused: v.paused }))).toEqual({ ...originalVideo, paused: true });
    expect(await page.locator('#output').evaluate(c => [c.width,c.height])).toEqual([1920,1080]);
    await page.screenshot({ path: testInfo.outputPath(`theme-${theme}.png`), fullPage: true });
  }
  expect(new Set(palettes).size).toBe(4);
  await page.reload(); await expect(page.locator('#theme')).toHaveValue('tropicana');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'tropicana');
  const second = await page.context().newPage(); await second.goto('/'); await expect(second.locator('#theme')).toHaveValue('tropicana');
  await page.locator('#theme').selectOption('sunset'); await expect(second.locator('#theme')).toHaveValue('sunset'); await second.close();
  await page.evaluate(() => localStorage.setItem('mist-theme', 'unknown-palette')); await page.reload();
  await expect(page.locator('#theme')).toHaveValue('classic'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
  expect(errors).toEqual([]);
});

test('theme selection works when local storage is blocked', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
  await page.goto('/'); await expect(page.locator('#theme')).toHaveValue('classic');
  await page.locator('#theme').selectOption('sunset'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'sunset');
  await page.reload(); await expect(page.locator('#theme')).toHaveValue('classic'); expect(errors).toEqual([]);
});

test('independent channel bounds compose before master mapping without extra source passes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer.js'), { defaults } = await import('/src/parameters.js');
    const output = document.createElement('canvas'); output.width = output.height = 8; const r = new Renderer(output), master = defaults(true);
    const source = (id, color, bounds) => {
      const c = document.createElement('canvas'); c.width = c.height = 8; const ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0,0,8,8);
      Object.defineProperties(c, { videoWidth: { value: 8 }, videoHeight: { value: 8 }, readyState: { value: 4 } });
      return { id, video: c, values: { ...defaults(), opacity: 1, ...bounds }, dirty: true };
    };
    const red = source('red', 'red', { mapX2: .5 }), blue = source('blue', 'blue', { mapX1: .5 });
    const pixel = (x,y = 4) => { const b = new Uint8Array(4); r.gl.readPixels(x,y,1,1,r.gl.RGBA,r.gl.UNSIGNED_BYTE,b); return [...b]; };
    let draws = 0; const draw = r.gl.drawArrays.bind(r.gl); r.gl.drawArrays = (...args) => { draws++; return draw(...args); };
    r.render([red,blue], master); const sourceOnly = { left: pixel(1), right: pixel(6), draws, textures: r.textures.size };
    draws = 0; r.render([red,blue], { ...master, mapX1: .25, mapX2: .75, mapY1: .25, mapY2: .75 });
    const combined = { outside: pixel(0), left: pixel(3), right: pixel(4), draws };
    red.values.mapX2 = .25; r.render([red,blue], master); const changed = pixel(3);
    Object.assign(red.values, defaults(), { opacity: 1 }); r.render([red], master); const reset = pixel(6);
    const error = r.gl.getError(); r.dispose(); return { sourceOnly, combined, changed, reset, error };
  });
  expect(result.sourceOnly.left).toEqual([255,0,0,255]); expect(result.sourceOnly.right).toEqual([0,0,255,255]);
  expect(result.sourceOnly.draws).toBe(2); expect(result.sourceOnly.textures).toBe(2);
  expect(result.combined.outside).toEqual([0,0,0,255]); expect(result.combined.left).toEqual([255,0,0,255]); expect(result.combined.right).toEqual([0,0,255,255]); expect(result.combined.draws).toBe(3);
  expect(result.changed).toEqual([0,0,0,255]); expect(result.reset).toEqual([255,0,0,255]); expect(result.error).toBe(0);
});

test('source mapping keeps independent bounds through selection and replacement; resets are scoped', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); const fixture = await clip(page);
  await page.locator('#file-input').setInputFiles([fixture, { ...fixture, name: 'second.webm' }]);
  const first = page.locator('.source-row').first(), second = page.locator('.source-row').nth(1), master = page.locator('.master');
  const set = async (row, key, value) => { await row.locator('.channel-select').click(); const input = row.locator(`[data-parameter=${key}] input`); await input.fill(String(value)); await input.press('Enter'); };
  await set(first, 'opacity', 75); await set(first, 'mapX2', 45); await set(first, 'mapY1', 10);
  await set(second, 'mapX1', 55); await set(master, 'mapY2', 90);
  await first.locator('.channel-select').click();
  await expect(first.locator('[data-parameter=mapX2] .knob')).toHaveAttribute('aria-valuenow', '0.45');
  await expect(first.locator('[data-parameter=mapY1] .knob')).toHaveAttribute('aria-valuenow', '0.1');
  // Bounds must stay ordered even when a numeric edit would cross the other side.
  await set(first, 'mapX1', 90); await expect(first.locator('[data-parameter=mapX1] .knob')).toHaveAttribute('aria-valuenow', '0.449');
  await first.getByRole('button', { name: 'Eject / replace video', exact: true }).click(); await page.locator('#replace-input').setInputFiles({ ...fixture, name: 'mapped-replacement.webm' });
  await expect(first.locator('[data-parameter=mapY1] .knob')).toHaveAttribute('aria-valuenow', '0.1');
  await first.locator('.mapping-reset').click();
  await expect(first.locator('[data-parameter=mapX2] .knob')).toHaveAttribute('aria-valuenow', '1');
  await expect(first.locator('[data-parameter=opacity] .knob')).toHaveAttribute('aria-valuenow', '0.75');
  await expect(second.locator('[data-parameter=mapX1] .knob')).toHaveAttribute('aria-valuenow', '0.55');
  await expect(master.locator('[data-parameter=mapY2] .knob')).toHaveAttribute('aria-valuenow', '0.9');
  await set(first, 'mapX1', 5); await first.getByRole('button', { name: 'Reset source effects', exact: true }).click();
  await expect(first.locator('[data-parameter=mapX1] .knob')).toHaveAttribute('aria-valuenow', '0');
  await page.screenshot({ path: testInfo.outputPath('channel-mapping.png'), fullPage: true });
  await page.locator('#reset-all').click();
  await expect(second.locator('[data-parameter=mapX1] .knob')).toHaveAttribute('aria-valuenow', '0');
  await expect(master.locator('[data-parameter=mapY2] .knob')).toHaveAttribute('aria-valuenow', '1');
  expect(errors).toEqual([]);
});

test('mapping render benchmark at 1080p with three sources', async ({ page }, testInfo) => {
  await page.goto('/');
  const report = await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer.js'), { defaults } = await import('/src/parameters.js');
    const output = document.createElement('canvas'); output.width = 1920; output.height = 1080;
    const r = new Renderer(output), master = defaults(true);
    const sources = ['red','green','blue'].map((color, i) => {
      const c = document.createElement('canvas'); c.width = 640; c.height = 360;
      const ctx = c.getContext('2d'); const gradient = ctx.createLinearGradient(0,0,640,360); gradient.addColorStop(0,color); gradient.addColorStop(1,'white'); ctx.fillStyle = gradient; ctx.fillRect(0,0,640,360);
      Object.defineProperties(c, { videoWidth: { value: 640 }, videoHeight: { value: 360 }, readyState: { value: 4 } });
      return { id: String(i), video: c, values: { ...defaults(), opacity: .5 }, dirty: true };
    });
    const pixel = new Uint8Array(4);
    function completedFrame(params) {
      r.render(sources, params);
      // Read back one pixel to force actual completion, including in offscreen software GL.
      r.gl.readPixels(960,540,1,1,r.gl.RGBA,r.gl.UNSIGNED_BYTE,pixel);
    }
    function measure(params) {
      for (let i = 0; i < 3; i++) { completedFrame(params); }
      const times = [];
      for (let i = 0; i < 8; i++) { const start = performance.now(); completedFrame(params); times.push(performance.now() - start); }
      times.sort((a,b) => a-b); return Math.round((times[3] + times[4]) / 2 * 100) / 100;
    }
    const baselineMs = measure(master);
    sources.forEach(source => Object.assign(source.values, { mapX1: .01, mapX2: .99, mapY1: .01, mapY2: .99 }));
    const sourceMappingMs = measure(master);
    const sourceAndMasterMappingMs = measure({ ...master, mapX1: .01, mapX2: .99, mapY1: .01, mapY2: .99 });
    const renderedPixel = [...pixel]; r.dispose(); return { baselineMs, sourceMappingMs, sourceAndMasterMappingMs, renderedPixel, note: 'Median synchronized render and one-pixel readback time, 3 static 640x360 textures at 1920x1080 on software Chromium. Excludes decoding/upload and is not an end-to-end FPS estimate. Synchronous readback is used in this benchmark only.' };
  });
  console.log('Mapping performance:', JSON.stringify(report));
  await testInfo.attach('mapping-performance', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  expect([report.baselineMs, report.sourceMappingMs, report.sourceAndMasterMappingMs].every(n => Number.isFinite(n) && n > 0)).toBe(true);
  expect(report.renderedPixel.slice(0,3).some(n => n > 0)).toBe(true);
});

test('video jump buttons seek five seconds and randomly without changing playback or other channels', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); const fixture = await clip(page,320,180,180);
  await page.locator('#file-input').setInputFiles([fixture, { ...fixture, name: 'second.webm' }]);
  const first = page.locator('.source-row').first(), second = page.locator('.source-row').nth(1), video = first.locator('video'), master = page.locator('.master');
  await expect(first.locator('small')).toContainText('PLAYING'); await expect(second.locator('small')).toContainText('PLAYING');
  for (const row of [first,second]) await row.getByRole('button', { name: 'Pause video', exact: true }).click();
  for (const label of ['Back 5 seconds','Forward 5 seconds','Random position']) await expect(first.getByRole('button', { name: label, exact: true })).toBeEnabled();
  const otherTime = await second.locator('video').evaluate(v => v.currentTime);
  await first.getByRole('button', { name: 'Back 5 seconds', exact: true }).click();
  await expect.poll(() => video.evaluate(v => v.currentTime)).toBe(0);
  await first.getByRole('button', { name: 'Forward 5 seconds', exact: true }).click();
  await expect.poll(() => video.evaluate(v => v.currentTime)).toBe(5);
  await expect.poll(() => video.evaluate(v => v.seeking)).toBe(false);
  expect(await video.evaluate(v => v.paused)).toBe(true);
  const end = await video.evaluate(v => (Number.isFinite(v.duration) ? v.duration : v.seekable.end(v.seekable.length - 1)) - .001);
  expect(end).toBeGreaterThan(5);
  await page.evaluate(() => { window.originalTestRandom = Math.random; Math.random = () => .5; });
  await first.getByRole('button', { name: 'Random position', exact: true }).click();
  await expect.poll(() => video.evaluate(v => v.currentTime)).toBeCloseTo(end * .5, 2);
  await page.evaluate(() => { Math.random = window.originalTestRandom; delete window.originalTestRandom; });
  expect(await video.evaluate(v => v.paused)).toBe(true);
  expect(await second.locator('video').evaluate(v => v.currentTime)).toBe(otherTime);
  await first.getByRole('button', { name: 'Play video', exact: true }).click();
  await first.getByRole('button', { name: 'Back 5 seconds', exact: true }).click();
  expect(await video.evaluate(v => v.paused)).toBe(false); await expect(first.locator('small')).toContainText('PLAYING');
  await master.getByRole('button', { name: 'Pause all sources', exact: true }).click();
  await first.getByRole('button', { name: 'Forward 5 seconds', exact: true }).click();
  expect(await video.evaluate(v => v.paused)).toBe(true); await expect(first.locator('small')).toContainText('PAUSED');
  await master.getByRole('button', { name: 'Resume all sources', exact: true }).click();
  await expect(first.locator('small')).toContainText('PLAYING'); await expect(second.locator('small')).toContainText('PAUSED');
  await page.screenshot({ path: testInfo.outputPath('seek-controls.png'), fullPage: true }); expect(errors).toEqual([]);
});

test('YouTube dialog loads a downloaded source, reports errors and cancels', async ({ page }) => {
  await page.goto('/'); const fixture = await clip(page);
  let fail = true;
  await page.route('**/api/download', async route => {
    expect(route.request().postDataJSON().url).toBe('https://youtu.be/q030WNZvXrA');
    await route.fulfill({ status: fail ? 400 : 200, contentType: 'application/json', body: JSON.stringify(fail ? { error: 'Video unavailable' } : { url: '/media/test.mp4', name: 'Downloaded scene.mp4' }) });
  });
  await page.route('**/media/test.mp4', route => route.fulfill({ contentType: 'video/mp4', body: fixture.buffer }));
  await page.getByRole('button', { name: 'Add YouTube video', exact: true }).click();
  await expect(page.locator('#download-dialog')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Search YouTube' })).toHaveAttribute('target', '_blank');
  await page.locator('#download-url').fill('https://youtu.be/q030WNZvXrA');
  await page.locator('#download-submit').click();
  await expect(page.locator('#download-status')).toHaveText('Video unavailable');
  fail = false; await page.locator('#download-submit').click();
  await expect(page.locator('#download-dialog')).not.toBeVisible();
  await expect(page.locator('#source-count')).toHaveText('1');
  await expect(page.locator('.source-name')).toContainText('Downloaded scene.mp4');
  await expect(page.locator('.source-row [role=slider]').first()).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Add YouTube video', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#download-dialog')).not.toBeVisible();
});
