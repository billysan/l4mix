import { test, expect } from '@playwright/test';

async function clip(page, width = 320, height = 180) {
  const bytes = await page.evaluate(async ({ width, height }) => {
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    const ctx = c.getContext('2d'); const stream = c.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks = []; recorder.ondataavailable = e => chunks.push(e.data);
    const done = new Promise(resolve => { recorder.onstop = resolve; }); recorder.start();
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = '#d05b32'; ctx.fillRect(0, 0, width / 2, height);
      ctx.fillStyle = '#588fc4'; ctx.fillRect(width / 2, 0, width / 2, height);
      ctx.fillStyle = '#d8fa77'; ctx.fillRect((i / 18) * width, height / 4, width / 8, height / 2);
      await new Promise(r => setTimeout(r, 34));
    }
    recorder.stop(); await done; stream.getTracks().forEach(t => t.stop());
    return Array.from(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()));
  }, { width, height });
  return { name: 'test-pattern.webm', mimeType: 'video/webm', buffer: Buffer.from(bytes) };
}
async function setValue(row, key, value) {
  const input = row.locator('input').nth(key); await input.fill(String(value)); await input.press('Enter');
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
    r.render([red], { ...master, inversion: 1 }, { enabled: true, points: [[.25,.25],[.75,.25],[.75,.75],[.25,.75]] });
    results.mappedCenter = pixel(4,4); results.mappedOutside = pixel(0,0);
    pattern.values.pixelation = 1;
    r.render([pattern], master, { enabled: true, points: [[0,0],[1,0],[1,1],[0,1]] }); results.mappedIdentity = pixel(1,6);
    r.render([red], master, { enabled: false, points: [[.25,.25],[.75,.25],[.75,.75],[.25,.75]] }); results.disabledMapping = pixel(0,0);
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
  near(checks.identity, [255,0,0,255]); near(checks.half, [128,0,128,255]); near(checks.zero, [255,0,0,255]); near(checks.full, [0,0,255,255]); near(checks.reorder, [255,0,0,255]);
  near(checks.masterInvert, [0,255,255,255]); near(checks.masterFade, [128,0,0,255]); near(checks.redGain, [0,0,0,255]);
  near(checks.gray, [54,54,54,255]); near(checks.brightness, [128,0,0,255]); near(checks.contrast, [128,128,128,255]);
  expect(checks.hue[0]).toBeLessThan(3); expect(checks.hue[1]).toBeGreaterThan(100);
  near(checks.topLeft, [255,0,0,255]); near(checks.bottomLeft, [0,0,255,255]);
  near(checks.cloneLeft, [255,0,0,255]); near(checks.cloneLeft, checks.cloneNext); near(checks.cloneRight, [0,255,0,255]); near(checks.cloneRight, checks.cloneRightNext); near(checks.cloneLeft, checks.cloneBottom); near(checks.pixelA, checks.pixelB);
  near(checks.mappedCenter, [0,255,255,255]); near(checks.mappedOutside, [0,0,0,255]); near(checks.mappedIdentity, [255,0,0,255]); near(checks.disabledMapping, [255,0,0,255]);
  expect(checks.textureRemoved).toBe(true); expect(checks.glError).toBe(0); near(checks.restored, [255,0,0,255]);
});

test('two-file lifecycle, knob interactions, replacement, and clean output', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  const fixture = await clip(page);
  await page.locator('#file-input').setInputFiles([fixture, { ...fixture, name: 'second.webm' }, { ...fixture, name: 'third.webm' }]);
  await expect(page.locator('.source-row')).toHaveCount(2);
  await expect(page.getByText('This version supports two videos', { exact: false })).toBeVisible();
  await expect(page.locator('.source-row').first().locator('small')).toContainText('PLAYING');
  await expect(page.locator('#empty-add')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add videos', exact: true })).toHaveCount(1);
  const first = page.locator('.source-row').first(); const second = page.locator('.source-row').nth(1);
  await expect(first.getByRole('slider').first()).toHaveAttribute('aria-valuenow', '0');
  await expect(second.getByRole('slider').first()).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#resolution')).toHaveValue('720');
  await setValue(first, 0, 100); await setValue(second, 0, 50);
  await expect(page.locator('#signal-label')).toHaveText('SIGNAL ACTIVE');
  await page.screenshot({ path: testInfo.outputPath('mixer.png'), fullPage: true });
  const hue = first.getByRole('slider').nth(10); await hue.focus(); await hue.press('ArrowUp'); await expect(hue).toHaveAttribute('aria-valuenow', '1'); await hue.dblclick(); await expect(hue).toHaveAttribute('aria-valuenow', '0');
  const opacity = first.getByRole('slider').first(); const bounds = await opacity.boundingBox(); await page.mouse.move(bounds.x + 20, bounds.y + 20); await page.mouse.down(); await page.mouse.move(bounds.x + 20, bounds.y + 60); await page.mouse.up(); await expect(opacity).toHaveAttribute('aria-valuenow', '0.75');
  await first.getByRole('button', { name: 'Pause video', exact: true }).click(); await expect(first.locator('small')).toContainText('PAUSED');
  await first.getByRole('button', { name: 'Loop video', exact: true }).click(); await expect(first.getByRole('button', { name: 'Loop video', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await first.getByRole('button', { name: 'Play video', exact: true }).click();
  await first.getByRole('button', { name: 'Move layer down', exact: true }).click(); await expect(page.locator('.source-row').first().locator('strong')).toHaveText('second.webm');
  const popupPromise = page.waitForEvent('popup'); await page.locator('#open-output').click(); const popup = await popupPromise;
  await expect.poll(() => popup.locator('video').evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2);
  expect(await popup.locator('video').evaluate(v => v.videoWidth)).toBe(1280);
  await page.locator('#resolution').selectOption('1080');
  await expect.poll(() => popup.locator('video').evaluate(v => v.videoHeight)).toBe(1080);
  await popup.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect.poll(() => popup.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await popup.close();
  const reopen = page.waitForEvent('popup'); await page.locator('#open-output').click(); const reopened = await reopen;
  await expect.poll(() => reopened.locator('video').evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2); await reopened.close();
  const row = page.locator('.source-row').first();
  await row.getByRole('button', { name: 'Replace video', exact: true }).click(); await page.locator('#replace-input').setInputFiles({ ...fixture, name: 'replacement.webm' });
  await expect(row.locator('strong')).toHaveText('replacement.webm'); await expect(row.getByRole('slider').first()).toHaveAttribute('aria-valuenow', '0.5');
  await row.getByRole('button', { name: 'Reset source effects', exact: true }).click(); await expect(row.getByRole('slider').first()).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('.source-row').nth(1).getByRole('slider').first()).toHaveAttribute('aria-valuenow', '0.75');
  await page.locator('#reset-all').click(); await expect(row.getByRole('slider').first()).toHaveAttribute('aria-valuenow', '0'); await expect(page.locator('.master').getByRole('slider').first()).toHaveAttribute('aria-valuenow', '1');
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
  await page.goto('/'); const fixture = await clip(page, 1920, 1080);
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

test('compact grayscale layout and four-corner output mapping', async ({ page }, testInfo) => {
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
  const color = await page.locator('.knob').first().evaluate(el => getComputedStyle(el).borderColor);
  const rgb = color.match(/\d+/g).map(Number); expect(rgb[0]).toBe(rgb[1]); expect(rgb[1]).toBe(rgb[2]);
  const handles = page.locator('.mapping-handle'); await expect(handles.first()).toBeHidden();
  await page.locator('#mapping-toggle').check(); await expect(handles).toHaveCount(4); await expect(handles.first()).toBeVisible();
  const bounds = await page.locator('#mapping-surface').boundingBox();
  await page.mouse.move(bounds.x, bounds.y); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .18, bounds.y + bounds.height * .2, { steps: 8 }); await page.mouse.up();
  const moved = await handles.first().evaluate(el => [el.style.getPropertyValue('--x'), el.style.getPropertyValue('--y')]);
  expect(parseFloat(moved[0])).toBeCloseTo(18, 0); expect(parseFloat(moved[1])).toBeCloseTo(20, 0);
  await page.screenshot({ path: testInfo.outputPath('mapping.png'), fullPage: true });
  // The popup receives the warped pixels and never receives editing markers.
  const popupPromise = page.waitForEvent('popup'); await page.locator('#open-output').click(); const popup = await popupPromise;
  await expect.poll(() => popup.locator('video').evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2);
  const pixels = await popup.locator('video').evaluate(video => {
    const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
    const ctx = c.getContext('2d'); ctx.drawImage(video, 0, 0);
    return { outside: [...ctx.getImageData(2,2,1,1).data], center: [...ctx.getImageData(c.width/2,c.height/2,1,1).data] };
  });
  expect(pixels.outside.slice(0,3).every(v => v < 5)).toBe(true); expect(pixels.center.slice(0,3).some(v => v > 30)).toBe(true);
  await expect(popup.locator('.mapping-handle')).toHaveCount(0); await popup.close();
  await page.locator('#mapping-toggle').uncheck(); await expect(handles.first()).toBeHidden();
  await page.locator('#mapping-toggle').check(); expect(await handles.first().evaluate(el => el.style.getPropertyValue('--x'))).toBe(moved[0]);
  await handles.first().focus(); await handles.first().press('ArrowRight');
  expect(parseFloat(await handles.first().evaluate(el => el.style.getPropertyValue('--x')))).toBeGreaterThan(parseFloat(moved[0]));
  await page.locator('#reset-mapping').click(); expect(await handles.first().evaluate(el => el.style.getPropertyValue('--x'))).toBe('0%');
  await handles.first().press('ArrowRight'); await page.locator('#reset-all').click();
  await expect(page.locator('#mapping-toggle')).not.toBeChecked(); await expect(handles.first()).toBeHidden();
  expect(await handles.first().evaluate(el => el.style.getPropertyValue('--x'))).toBe('0%');
  await expect(row.getByRole('slider').first()).toHaveAttribute('aria-valuenow', '0');
  expect(errors).toEqual([]);
});
