import { PARAMETERS, defaults, clampParameter, formatParameter, MAX_SOURCES } from './parameters.js';
import { Renderer } from './renderer.js';
import { defaultCorners, validCorners } from './mapping.js';

const $ = selector => document.querySelector(selector);
const sources = [];
const mapping = { enabled: false, points: defaultCorners() };
const master = { id: 'master', values: defaults(true), controls: new Map() };
let renderer, nextId = 1, replacementId = null, outputWindow = null, outputStream = null;
let renderDirty = true, lastRender = -Infinity, lastStats = performance.now(), frames = 0, disposed = false;
const canvas = $('#output');

function message(text, persistent = false) {
  const item = document.createElement('div'); item.className = 'message';
  const content = document.createElement('span'); content.textContent = text;
  const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss message'); close.onclick = () => item.remove();
  item.append(content, close); $('#messages').append(item);
  if (!persistent) setTimeout(() => item.remove(), 10000);
}
try {
  renderer = new Renderer(canvas, {
    onLost: error => { message(error?.message || 'Graphics context lost. Waiting for the browser to restore it…', true); $('#signal-label').textContent = 'GRAPHICS LOST'; },
    onRestored: () => { sources.forEach(s => { s.dirty = true; }); renderDirty = true; message('Graphics restored.'); updateMonitor(); },
  });
} catch (error) {
  message(error.message, true); $('#signal-label').textContent = 'GRAPHICS UNAVAILABLE';
  $('#open-output').disabled = true;
}

function knob(parameter, owner) {
  const cell = document.createElement('div'); cell.className = `knob-cell ${parameter.group || ''}`;
  const control = document.createElement('div'); control.className = 'knob'; control.tabIndex = 0; control.setAttribute('role', 'slider');
  control.setAttribute('aria-label', `${owner.id === 'master' ? 'Master' : 'Source ' + owner.number} ${parameter.label.toLowerCase()}`);
  control.setAttribute('aria-valuemin', parameter.min); control.setAttribute('aria-valuemax', parameter.max);
  control.title = `${parameter.label} · drag ↑↓ · Shift: fine · double-click: reset`;
  const indicator = document.createElement('span'); indicator.className = 'knob-indicator'; control.append(indicator);
  const input = document.createElement('input'); input.className = 'knob-value'; input.type = 'text'; input.inputMode = 'decimal';
  input.setAttribute('aria-label', `${control.getAttribute('aria-label')} numeric value`);
  const update = () => {
    const value = owner.values[parameter.key];
    control.style.setProperty('--rotation', `${-135 + (value - parameter.min) / (parameter.max - parameter.min) * 270}deg`);
    control.classList.toggle('is-changed', value !== (owner.id === 'master' ? (parameter.master ?? parameter.initial) : parameter.initial));
    control.setAttribute('aria-valuenow', value); control.setAttribute('aria-valuetext', formatParameter(parameter, value));
    if (document.activeElement !== input) input.value = formatParameter(parameter, value);
  };
  const set = value => { owner.values[parameter.key] = clampParameter(parameter, value); update(); renderDirty = true; updateMonitor(); };
  owner.controls.set(parameter.key, update);
  let drag = null;
  control.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); control.focus(); control.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, value: owner.values[parameter.key] }; control.classList.add('dragging');
  });
  control.addEventListener('pointermove', e => {
    if (!drag) return;
    const delta = (drag.y - e.clientY) * (parameter.max - parameter.min) / (e.shiftKey ? 1600 : 160);
    set(drag.value + delta);
  });
  const end = () => { drag = null; control.classList.remove('dragging'); };
  control.addEventListener('pointerup', end); control.addEventListener('lostpointercapture', end);
  control.addEventListener('dblclick', () => set(owner.id === 'master' ? (parameter.master ?? parameter.initial) : parameter.initial));
  control.addEventListener('keydown', e => {
    const direction = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (direction) { e.preventDefault(); set(owner.values[parameter.key] + direction * parameter.step * (e.shiftKey ? 1 : parameter.step < 1 ? 5 : 1)); }
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); set(e.key === 'Home' ? parameter.min : parameter.max); }
  });
  input.addEventListener('focus', () => { input.value = String(Number((owner.values[parameter.key] * (parameter.scale || 1)).toFixed(2))); input.select(); });
  const commit = () => {
    if (input.value.trim() !== '') {
      const value = Number(input.value.replace(/[×%°]|px/g, '')) / (parameter.scale || 1);
      if (Number.isFinite(value)) set(value);
    }
    input.value = formatParameter(parameter, owner.values[parameter.key]);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { input.blur(); control.focus(); }
    if (e.key === 'Escape') { input.value = formatParameter(parameter, owner.values[parameter.key]); input.blur(); control.focus(); }
  });
  update(); cell.append(control, input); return cell;
}

for (const p of PARAMETERS) {
  const label = document.createElement('div'); label.textContent = p.label; label.className = `parameter-label ${p.group || ''}`; $('#column-headings').append(label);
}
const masterRow = document.createElement('div'); masterRow.className = 'matrix-row master'; masterRow.dataset.source = 'master';
const masterLabel = document.createElement('div'); masterLabel.className = 'source-cell master-label';
masterLabel.innerHTML = '<strong>Master</strong><button class="reset-button" aria-label="Reset master effects" title="Reset master effects">RESET</button>';
masterLabel.querySelector('button').onclick = () => reset(master);
masterRow.append(masterLabel, ...PARAMETERS.map(p => knob(p, master))); $('#master-row').append(masterRow);

function reset(owner) {
  Object.assign(owner.values, defaults(owner.id === 'master'));
  owner.controls.forEach(update => update()); renderDirty = true; updateMonitor();
}
function updateMonitor() {
  if (!renderer) return;
  if (renderer.lost) return;
  const active = sources.some(s => !s.error && s.video.readyState >= 2 && s.values.opacity > 0) && master.values.opacity > 0;
  $('#signal-label').textContent = active ? 'SIGNAL ACTIVE' : sources.length ? 'SOURCES READY / OPACITY 0' : 'NO SIGNAL';
  $('#signal-label').classList.toggle('active', active);
}
function updateRows() {
  const container = $('#source-rows');
  for (const source of sources) {
    container.append(source.row);
    const index = sources.indexOf(source);
    source.up.disabled = index === 0; source.down.disabled = index === sources.length - 1;
  }
  $('#source-count').textContent = `${sources.length} / ${MAX_SOURCES} SOURCES`;
  $('#empty-add').disabled = sources.length >= MAX_SOURCES;
  renderDirty = true; updateMonitor();
}
function sourceButton(text, label, action) {
  const b = document.createElement('button'); b.className = 'icon-button'; b.textContent = text; b.title = label; b.setAttribute('aria-label', label); b.onclick = action; return b;
}
function sourceError(source, text) {
  if (source.removed) return;
  source.error = true; clearTimeout(source.loadTimeout); source.video.pause(); source.status.textContent = 'PLAYBACK ERROR'; source.status.classList.add('error'); source.dirty = true; renderDirty = true;
  message(`${source.file.name}: ${text} Try replacing it with a browser-playable MP4 or WebM.`, true); updateMonitor();
}
async function play(source) {
  try { await source.video.play(); }
  catch (error) {
    if (source.removed || error.name === 'AbortError') return;
    if (error.name === 'NotAllowedError') { source.status.textContent = 'CLICK PLAY'; message('Playback needs a click. Use the source’s play button.'); }
    else sourceError(source, 'The browser could not play this file.');
  }
}
function disposeSource(source) {
  source.removed = true;
  if (source.frameHandle != null && source.video.cancelVideoFrameCallback) source.video.cancelVideoFrameCallback(source.frameHandle);
  clearTimeout(source.loadTimeout); source.video.pause(); source.video.removeAttribute('src'); source.video.load(); source.video.remove();
  URL.revokeObjectURL(source.url); renderer?.remove(source.id); source.controls.clear(); source.row.remove();
}
function removeSource(source) {
  const index = sources.indexOf(source); if (index < 0) return;
  sources.splice(index, 1); disposeSource(source); updateRows();
}
function createSource(file, existing = null) {
  const number = nextId++;
  const source = { id: `source-${number}`, number, file, values: existing ? { ...existing.values } : defaults(), controls: new Map(), dirty: true, error: false, removed: false, frameHandle: null };
  const video = document.createElement('video'); source.video = video;
  video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
  source.url = URL.createObjectURL(file); video.src = source.url;
  const row = document.createElement('div'); row.className = 'matrix-row source-row'; row.dataset.source = source.id; source.row = row;
  const cell = document.createElement('div'); cell.className = 'source-cell';
  const thumb = document.createElement('div'); thumb.className = 'thumbnail'; thumb.append(video);
  const badge = document.createElement('span'); badge.className = 'source-badge'; badge.textContent = String(number).padStart(2, '0'); thumb.append(badge);
  const details = document.createElement('div'); details.className = 'source-details';
  const name = document.createElement('strong'); name.textContent = file.name; name.title = file.name;
  const status = document.createElement('small'); status.textContent = 'LOADING…'; source.status = status;
  const transport = document.createElement('div'); transport.className = 'transport';
  const playButton = sourceButton('Ⅱ', 'Pause video', () => { if (video.paused) play(source); else video.pause(); });
  const loop = sourceButton('↻', 'Loop video', () => { video.loop = !video.loop; loop.classList.toggle('enabled', video.loop); loop.setAttribute('aria-pressed', video.loop); }); loop.classList.add('enabled'); loop.setAttribute('aria-pressed', 'true');
  const replace = sourceButton('⇄', 'Replace video', () => { replacementId = source.id; $('#replace-input').click(); });
  const resetSource = sourceButton('RESET', 'Reset source effects', () => reset(source)); resetSource.className = 'reset-button';
  transport.append(playButton, loop, replace, resetSource); details.append(name, status, transport);
  const operations = document.createElement('div'); operations.className = 'row-operations';
  const move = amount => { const index = sources.indexOf(source), to = index + amount; if (to < 0 || to >= sources.length) return; [sources[index], sources[to]] = [sources[to], sources[index]]; updateRows(); };
  source.up = sourceButton('↑', 'Move layer up', () => move(-1)); source.down = sourceButton('↓', 'Move layer down', () => move(1));
  operations.append(source.up, source.down, sourceButton('×', 'Remove video', () => removeSource(source)));
  cell.append(thumb, details, operations); row.append(cell, ...PARAMETERS.map(p => knob(p, source)));
  const updateStatus = () => {
    if (source.error || source.removed) return;
    status.textContent = `${video.videoWidth}×${video.videoHeight} · ${video.paused ? 'PAUSED' : 'PLAYING'}`;
    playButton.textContent = video.paused ? '▶' : 'Ⅱ'; playButton.setAttribute('aria-label', video.paused ? 'Play video' : 'Pause video'); playButton.title = playButton.getAttribute('aria-label');
    renderDirty = true; updateMonitor();
  };
  video.addEventListener('loadeddata', () => { if (source.removed) return; clearTimeout(source.loadTimeout); source.dirty = true; updateStatus(); play(source); });
  video.addEventListener('error', () => { clearTimeout(source.loadTimeout); sourceError(source, 'Unsupported codec, damaged file, or decoding failure.'); });
  for (const event of ['play', 'pause', 'ended', 'seeked']) video.addEventListener(event, updateStatus);
  video.addEventListener('timeupdate', () => { if (!video.requestVideoFrameCallback) source.dirty = true; });
  if (video.requestVideoFrameCallback) {
    const onFrame = () => { if (source.removed) return; source.dirty = true; source.frameHandle = video.requestVideoFrameCallback(onFrame); };
    source.frameHandle = video.requestVideoFrameCallback(onFrame);
  }
  source.onRenderError = error => sourceError(source, `Could not upload the video frame (${error.name}).`);
  source.loadTimeout = setTimeout(() => { if (!source.removed && video.readyState < 2 && !source.error) { status.textContent = 'STILL LOADING'; message(`${file.name} is taking a while to load. If it stays blank, replace it with an MP4 or WebM.`); } }, 15000);
  return source;
}
function addFiles(files) {
  const list = Array.from(files);
  const accepted = list.filter(file => file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|ogv|ogg|mkv)$/i.test(file.name));
  if (accepted.length !== list.length) message('Only video files can be added.');
  const slots = MAX_SOURCES - sources.length;
  if (accepted.length > slots) message('This version supports two videos at a time. Remove or replace a source to try another.');
  for (const file of accepted.slice(0, slots)) sources.push(createSource(file));
  updateRows();
}
$('#empty-add').onclick = () => $('#file-input').click();
$('#file-input').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('#replace-input').onchange = e => {
  const file = e.target.files[0];
  const index = sources.findIndex(s => s.id === replacementId);
  if (file && index >= 0) { const previous = sources[index]; sources[index] = createSource(file, previous); disposeSource(previous); updateRows(); }
  replacementId = null; e.target.value = '';
};
let dragDepth = 0;
window.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
window.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragDepth++; $('#drop-zone').classList.add('drag-over'); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop-zone').classList.remove('drag-over'); });
window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('#drop-zone').classList.remove('drag-over'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
$('#reset-all').onclick = () => { sources.forEach(reset); reset(master); mapping.enabled = false; $('#mapping-toggle').checked = false; resetMapping(); };
$('#resolution').onchange = e => {
  if (!renderer) return;
  const h = Number(e.target.value);
  try { renderer.resize(Math.round(h * 16 / 9), h); renderDirty = true; }
  catch (error) { message(error.message, true); renderer.resize(1280, 720); e.target.value = '720'; }
};
function stopOutputStream() { outputStream?.getTracks().forEach(track => track.stop()); outputStream = null; }
window.addEventListener('mist-output-ready', e => {
  if (e.detail !== outputWindow) return;
  try {
    stopOutputStream();
    if (!canvas.captureStream) throw new Error('Canvas streaming is unavailable in this browser. Try a current Chromium or Firefox browser.');
    outputStream = canvas.captureStream(30); outputWindow.setMixerStream(outputStream); renderDirty = true;
    outputWindow.addEventListener('pagehide', () => { stopOutputStream(); $('#open-output').innerHTML = 'Open clean output <span aria-hidden="true">↗</span>'; });
    $('#open-output').innerHTML = 'Focus clean output <span aria-hidden="true">↗</span>';
  } catch (error) { message(`Clean output: ${error.message}`, true); }
});
$('#open-output').onclick = () => {
  if (outputWindow && !outputWindow.closed) { outputWindow.focus(); return; }
  outputWindow = window.open('/output.html', 'mist-clean-output', 'popup,width=960,height=540');
  if (!outputWindow) message('The output window was blocked. Allow pop-ups for this local site, then click Open clean output again.', true);
};
function tick(now) {
  if (disposed) return;
  requestAnimationFrame(tick);
  // Leave the compositor at 30 Hz even on high-refresh-rate displays.
  if (now - lastRender < 1000 / 30 - 1) return;
  const playing = sources.some(s => !s.error && !s.video.paused && s.values.opacity > 0);
  const visibleOutput = outputWindow && !outputWindow.closed;
  if (document.hidden && !visibleOutput) return;
  if (renderer && (renderDirty || playing || sources.some(s => s.dirty && s.values.opacity > 0))) {
    try { if (renderer.render(sources, master.values, mapping)) { renderDirty = false; frames++; } }
    catch (error) { message(`Rendering stopped: ${error.message}. Try 720p or reload the mixer.`, true); renderer = null; }
  }
  lastRender = now;
  if (now - lastStats >= 1000) {
    const fps = frames * 1000 / (now - lastStats); $('#fps').textContent = Math.round(fps);
    $('#performance-dot').classList.toggle('slow', playing && fps < 24);
    $('#dropped').textContent = sources.reduce((sum, s) => sum + (s.video.getVideoPlaybackQuality?.().droppedVideoFrames || 0), 0);
    lastStats = now; frames = 0;
  }
}
// rAF pauses in background tabs. Keep the same throttled render path alive for a second monitor.
const backgroundTimer = setInterval(() => {
  if (!document.hidden || !outputWindow || outputWindow.closed || !renderer || renderer.lost) return;
  if (renderDirty || sources.some(s => s.values.opacity > 0 && (!s.video.paused || s.dirty))) {
    try { renderer.render(sources, master.values, mapping); renderDirty = false; } catch { /* foreground path reports failures */ }
  }
}, 1000 / 30);
window.addEventListener('pagehide', () => {
  disposed = true; clearInterval(backgroundTimer); sources.forEach(disposeSource); stopOutputStream(); renderer?.dispose(); if (outputWindow && !outputWindow.closed) outputWindow.close();
});
const handles = [...document.querySelectorAll('.mapping-handle')];
function updateMapping() {
  $('#mapping-overlay').hidden = !mapping.enabled;
  $('#reset-mapping').disabled = !mapping.enabled;
  mapping.points.forEach(([x, y], i) => {
    handles[i].style.setProperty('--x', `${x * 100}%`);
    handles[i].style.setProperty('--y', `${y * 100}%`);
    handles[i].setAttribute('aria-description', `${Math.round(x * 100)}% horizontal, ${Math.round(y * 100)}% vertical. Use arrow keys to move.`);
  });
  $('#mapping-outline').setAttribute('points', mapping.points.map(([x, y]) => `${x * 100},${y * 100}`).join(' '));
  renderDirty = true;
}
function resetMapping() { mapping.points = defaultCorners(); updateMapping(); }
function moveCorner(index, x, y) {
  const points = mapping.points.map(p => [...p]);
  points[index] = [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  if (!validCorners(points)) return;
  mapping.points = points; updateMapping();
}
$('#mapping-toggle').onchange = e => { mapping.enabled = e.target.checked; updateMapping(); };
$('#reset-mapping').onclick = resetMapping;
handles.forEach((handle, index) => {
  let dragging = false;
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); handle.focus(); handle.setPointerCapture(e.pointerId); dragging = true;
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging || !mapping.enabled) return;
    const bounds = $('#mapping-surface').getBoundingClientRect();
    moveCorner(index, (e.clientX - bounds.left) / bounds.width, (e.clientY - bounds.top) / bounds.height);
  });
  const end = () => { dragging = false; };
  handle.addEventListener('pointerup', end); handle.addEventListener('lostpointercapture', end);
  handle.addEventListener('dblclick', () => { const [x, y] = defaultCorners()[index]; moveCorner(index, x, y); });
  handle.addEventListener('keydown', e => {
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (direction) {
      e.preventDefault(); const step = e.shiftKey ? .001 : .01;
      moveCorner(index, mapping.points[index][0] + direction[0] * step, mapping.points[index][1] + direction[1] * step);
    }
  });
});
updateMapping(); updateRows(); requestAnimationFrame(tick);
