import { PARAMETERS, defaults, clampParameter, formatParameter, MAX_SOURCES } from './parameters.js';
import { Renderer } from './renderer.js';
import { defaultCorners, validCorners, identityCorners } from './mapping.js';
import { SourceTransport } from './transport.js';
import { icon } from './icons.js';
import { controlNavigation } from './navigation.js';

const $ = selector => document.querySelector(selector);
const sources = [];
const mapping = { editing: false, points: defaultCorners() };
const master = { id: 'master', values: defaults(true), controls: new Map(), paused: false, preview: true };
let renderer, nextId = 1, replacementId = null, outputWindow = null, outputStream = null;
let renderDirty = true, lastRender = -Infinity, lastStats = performance.now(), frames = 0, disposed = false;
const canvas = $('#output');
let selectedOwner = master;

function message(text, persistent = false) {
  const item = document.createElement('div'); item.className = 'message';
  const content = document.createElement('span'); content.textContent = text;
  const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss message'); close.onclick = () => item.remove();
  item.append(content, close); $('#messages').append(item);
  if (!persistent) setTimeout(() => item.remove(), 10000);
}
try {
  renderer = new Renderer(canvas, {
    onLost: error => { message(error?.message || 'Graphics context lost. Waiting for the browser to restore it…', true); setSignal(false, 'Graphics context lost'); },
    onRestored: () => { sources.forEach(s => { s.dirty = true; }); renderDirty = true; message('Graphics restored.'); updateMonitor(); },
  });
} catch (error) {
  message(error.message, true); setSignal(false, 'Graphics unavailable');
  $('#open-output').disabled = true;
}

function knob(parameter, owner) {
  const cell = document.createElement('div'); cell.className = `knob-cell ${parameter.group || ''}`; cell.dataset.parameter = parameter.key;
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
    if (e.ctrlKey || e.altKey || e.metaKey) return;
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
  const label = document.createElement('span'); label.className = 'parameter-label'; label.textContent = parameter.label;
  update(); cell.append(label, control, input); return cell;
}

const EFFECT_GROUPS = [
  ['OPACITY', ['opacity']],
  ['RGB', ['red', 'green', 'blue']],
  ['COLORS', ['brightness', 'contrast', 'saturation', 'hue']],
  ['EFFECTS', ['inversion', 'mirrorX', 'mirrorY', 'pixelation']],
];
function effectPanel(owner) {
  const panel = document.createElement('div'); panel.className = 'channel-effects'; owner.panel = panel;
  panel.setAttribute('aria-label', owner.id === 'master' ? 'Master effects' : `Source ${owner.number} effects`);
  for (const [name, keys] of EFFECT_GROUPS) {
    const group = document.createElement('section'); group.className = `effect-group group-${name.toLowerCase()}`;
    const heading = document.createElement('h2'); heading.textContent = name; group.append(heading);
    const grid = document.createElement('div'); grid.className = 'effect-knobs';
    for (const key of keys) grid.append(knob(PARAMETERS.find(p => p.key === key), owner));
    group.append(grid); panel.append(group);
  }
  return panel;
}
function selectChannel(owner) {
  selectedOwner = owner;
  for (const item of [...sources, master]) {
    const selected = item === owner;
    item.panel.hidden = !selected;
    item.row.classList.toggle('channel-selected', selected);
    item.selector.setAttribute('aria-pressed', selected);
  }
}
function channelSelector(owner, cell, text) {
  const button = document.createElement('button'); button.className = 'channel-select'; button.textContent = text;
  button.setAttribute('aria-label', owner === master ? 'Select master' : `Select source ${owner.number}`);
  button.onclick = () => selectChannel(owner); owner.selector = button;
  cell.addEventListener('pointerdown', () => selectChannel(owner));
  cell.addEventListener('focusin', () => selectChannel(owner));
  return button;
}
const monitorPlaceholder = document.createElement('div'); monitorPlaceholder.className = 'monitor-placeholder'; monitorPlaceholder.innerHTML = icon('eyeOff'); monitorPlaceholder.hidden = true; canvas.after(monitorPlaceholder);
const masterRow = document.createElement('div'); masterRow.className = 'matrix-row master'; masterRow.dataset.source = 'master'; master.row = masterRow;
const masterLabel = document.createElement('div'); masterLabel.className = 'source-cell';
const masterThumb = document.createElement('div'); masterThumb.className = 'thumbnail master-thumbnail';
const masterEye = iconButton('eye', 'Master monitor', () => {
  master.preview = !master.preview; updateMaster(); updateMapping(); renderDirty = true;
});
masterEye.classList.add('preview-eye'); masterThumb.append(masterEye);
const masterDetails = document.createElement('div'); masterDetails.className = 'source-details';
masterDetails.append(channelSelector(master, masterLabel, 'MASTER'));
const masterStatus = document.createElement('small'); masterStatus.id = 'master-status'; masterStatus.textContent = 'IDLE'; masterDetails.append(masterStatus);
const masterTransport = document.createElement('div'); masterTransport.className = 'transport';
const masterPlay = iconButton('pause', 'Pause all sources', toggleMasterPause);
const masterReset = sourceButton('RESET', 'Reset master effects', () => reset(master)); masterReset.className = 'reset-button';
masterTransport.append(masterPlay, masterReset); masterDetails.append(masterTransport);
const masterOperations = document.createElement('div'); masterOperations.className = 'row-operations';
masterLabel.append(masterThumb, masterDetails, masterOperations);
masterRow.append(masterLabel, effectPanel(master)); $('#master-row').append(masterRow);
const navigation = controlNavigation($('#matrix'), { selectChannel, owners: () => [...sources, master], selected: () => selectedOwner });

function updateMaster() {
  setIcon(masterPlay, master.paused ? 'play' : 'pause', master.paused ? 'Resume all sources' : 'Pause all sources');
  setIcon(masterEye, master.preview ? 'eye' : 'eyeOff'); masterEye.setAttribute('aria-pressed', master.preview);
  masterEye.title = master.preview ? 'Hide output monitor' : 'Show output monitor';
  $('#master-status').textContent = !sources.length ? 'IDLE' : master.paused ? 'PAUSED' : 'PLAYING';
  $('#monitor-shell').classList.toggle('preview-disabled', !master.preview); monitorPlaceholder.hidden = master.preview;
}
function toggleMasterPause() {
  master.paused = !master.paused;
  for (const source of sources) {
    if (master.paused) { source.resumeAfterMaster = !source.transport.paused; source.transport.pause(); }
    else if (source.resumeAfterMaster && !source.error) { source.resumeAfterMaster = false; source.transport.play(); }
    source.updateStatus();
  }
  updateMaster(); renderDirty = true;
}
function setSignal(active, title = '') {
  $('#signal-label').textContent = `${active ? 'V' : 'X'} SIGNAL`;
  $('#signal-label').classList.toggle('active', active); $('#signal-label').title = title;
}

function reset(owner) {
  Object.assign(owner.values, defaults(owner.id === 'master'));
  owner.controls.forEach(update => update()); renderDirty = true; updateMonitor();
}
function updateMonitor() {
  if (!renderer) return;
  if (renderer.lost) return;
  const active = sources.some(s => !s.error && s.video.readyState >= 2 && s.values.opacity > 0) && master.values.opacity > 0;
  setSignal(active);
}
function updateRows() {
  const container = $('#source-rows');
  for (const source of sources) {
    container.append(source.row);
  }
  $('#source-count').textContent = `${sources.length} / ${MAX_SOURCES}`;
  $('#empty-add').disabled = sources.length >= MAX_SOURCES;
  if (![...sources, master].includes(selectedOwner)) selectedOwner = sources[0] || master;
  selectChannel(selectedOwner);
  renderDirty = true; updateMonitor(); updateMaster(); navigation.refresh();
}
function sourceButton(text, label, action) {
  const b = document.createElement('button'); b.className = 'icon-button'; b.textContent = text; b.title = label; b.setAttribute('aria-label', label); b.onclick = action; return b;
}
function sourceError(source, text) {
  if (source.removed) return;
  source.error = true; clearTimeout(source.loadTimeout); source.transport.pause(); source.status.textContent = 'PLAYBACK ERROR'; source.status.classList.add('error'); source.dirty = true; renderDirty = true;
  message(`${source.file.name}: ${text} Try replacing it with a browser-playable MP4 or WebM.`, true); updateMonitor();
}
function setIcon(button, name, label) {
  button.innerHTML = icon(name);
  if (label) { button.setAttribute('aria-label', label); button.title = label; }
}
function iconButton(name, label, action) {
  const button = sourceButton('', label, action); setIcon(button, name); return button;
}
function updateSourcePreview(source) {
  source.video.hidden = !source.preview;
  setIcon(source.eye, source.preview ? 'eye' : 'eyeOff'); source.eye.setAttribute('aria-pressed', source.preview);
  source.eye.title = source.preview ? 'Hide source preview' : 'Show source preview';
}
function play(source) {
  if (master.paused) { source.resumeAfterMaster = true; source.updateStatus(); return; }
  return source.transport.play();
}
function disposeSource(source) {
  source.removed = true;
  if (source.frameHandle != null && source.video.cancelVideoFrameCallback) source.video.cancelVideoFrameCallback(source.frameHandle);
  clearTimeout(source.loadTimeout); source.transport.dispose(); source.video.removeAttribute('src'); source.video.load(); source.video.remove();
  URL.revokeObjectURL(source.url); renderer?.remove(source.id); source.controls.clear(); source.row.remove();
}
function removeSource(source) {
  const index = sources.indexOf(source); if (index < 0) return;
  sources.splice(index, 1); disposeSource(source); updateRows();
}
function createSource(file, existing = null) {
  const number = nextId++;
  const source = { id: `source-${number}`, number, file, values: existing ? { ...existing.values } : defaults(), controls: new Map(), dirty: true, error: false, removed: false, frameHandle: null, preview: existing?.preview ?? false };
  const video = document.createElement('video'); source.video = video;
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.hidden = !source.preview;
  source.transport = new SourceTransport(video, {
    onChange: () => source.updateStatus?.(),
    onError: error => {
      if (source.removed) return;
      if (error.name === 'NotAllowedError') { source.status.textContent = 'CLICK PLAY'; message('Playback needs a click. Use the source’s play button.'); }
      else sourceError(source, 'The browser could not play this file.');
    },
  });
  source.url = URL.createObjectURL(file); video.src = source.url;
  const row = document.createElement('div'); row.className = 'matrix-row source-row'; row.dataset.source = source.id; source.row = row;
  const cell = document.createElement('div'); cell.className = 'source-cell';
  const thumb = document.createElement('div'); thumb.className = 'thumbnail'; thumb.append(video);
  const togglePlayback = () => { if (source.transport.paused) play(source); else source.transport.pause(); };
  source.eye = iconButton('eyeOff', 'Source preview', () => { source.preview = !source.preview; updateSourcePreview(source); }); source.eye.classList.add('preview-eye'); thumb.append(source.eye);
  const badge = document.createElement('span'); badge.className = 'source-badge'; badge.textContent = String(number).padStart(2, '0'); thumb.append(badge);
  const details = document.createElement('div'); details.className = 'source-details';
  const nameButton = channelSelector(source, cell, file.name); nameButton.classList.add('source-name'); nameButton.textContent = '';
  const name = document.createElement('strong'); name.textContent = file.name; nameButton.title = `Select ${file.name}`; nameButton.append(name);
  const status = document.createElement('small'); status.textContent = 'LOADING…'; source.status = status;
  const transport = document.createElement('div'); transport.className = 'transport';
  const playButton = iconButton('pause', 'Pause video', togglePlayback); source.playButton = playButton;
  const eject = iconButton('eject', 'Eject / replace video', () => { replacementId = source.id; $('#replace-input').click(); });
  const resetSource = sourceButton('RESET', 'Reset source effects', () => reset(source)); resetSource.className = 'reset-button';
  transport.append(playButton, eject, resetSource); details.append(nameButton, status, transport);
  const operations = document.createElement('div'); operations.className = 'row-operations';
  operations.append(sourceButton('×', 'Remove video', () => removeSource(source)));
  cell.append(thumb, details, operations); row.append(cell, effectPanel(source));
  source.updateStatus = () => {
    if (source.error || source.removed) return;
    const paused = source.transport.paused;
    status.textContent = `${video.videoWidth}×${video.videoHeight} · ${paused ? 'PAUSED' : 'PLAYING'}`;
    setIcon(playButton, paused ? 'play' : 'pause', paused ? 'Play video' : 'Pause video');
    playButton.disabled = master.paused;
    updateSourcePreview(source); renderDirty = true; updateMonitor();
  };
  updateSourcePreview(source);
  video.addEventListener('loadeddata', () => { if (source.removed) return; clearTimeout(source.loadTimeout); source.dirty = true; source.updateStatus(); play(source); });
  video.addEventListener('error', () => { clearTimeout(source.loadTimeout); sourceError(source, 'Unsupported codec, damaged file, or decoding failure.'); });
  for (const event of ['play', 'pause', 'ended', 'seeked']) video.addEventListener(event, source.updateStatus);
  video.addEventListener('seeked', () => { source.dirty = true; });
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
  const wasEmpty = sources.length === 0;
  const slots = MAX_SOURCES - sources.length;
  if (accepted.length > slots) message('This version supports two videos at a time. Remove or replace a source to try another.');
  for (const file of accepted.slice(0, slots)) sources.push(createSource(file));
  if (wasEmpty && sources.length) selectedOwner = sources[0];
  updateRows();
}
$('#empty-add').onclick = () => $('#file-input').click();
$('#file-input').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('#replace-input').onchange = e => {
  const file = e.target.files[0];
  const index = sources.findIndex(s => s.id === replacementId);
  if (file && index >= 0) { const previous = sources[index]; sources[index] = createSource(file, previous); if (selectedOwner === previous) selectedOwner = sources[index]; disposeSource(previous); updateRows(); }
  replacementId = null; e.target.value = '';
};
let dragDepth = 0;
window.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
window.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragDepth++; $('#drop-zone').classList.add('drag-over'); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop-zone').classList.remove('drag-over'); });
window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('#drop-zone').classList.remove('drag-over'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
$('#reset-all').onclick = () => { sources.forEach(reset); reset(master); mapping.editing = false; $('#mapping-toggle').checked = false; resetMapping(); };
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
    outputStream = canvas.captureStream(0);
    if (typeof outputStream.getVideoTracks()[0]?.requestFrame !== 'function') {
      stopOutputStream(); outputStream = canvas.captureStream(30);
    }
    outputWindow.setMixerStream(outputStream); renderDirty = true;
    outputWindow.addEventListener('pagehide', () => { stopOutputStream(); $('#open-output').innerHTML = 'Open clean output <span aria-hidden="true">↗</span>'; });
    $('#open-output').innerHTML = 'Focus clean output <span aria-hidden="true">↗</span>';
  } catch (error) { message(`Clean output: ${error.message}`, true); }
});
$('#open-output').onclick = () => {
  if (outputWindow && !outputWindow.closed) { outputWindow.focus(); return; }
  outputWindow = window.open('/output.html', 'mist-clean-output', 'popup,width=960,height=540');
  if (!outputWindow) message('The output window was blocked. Allow pop-ups for this local site, then click Open clean output again.', true);
};
function renderFrame(now, fromOutput = false) {
  if (disposed) return;
  // Leave the compositor at 30 Hz even on high-refresh-rate displays.
  if (now - lastRender < 1000 / 30 - 1) return;
  const playing = sources.some(s => !s.error && !s.transport.paused && s.values.opacity > 0);
  if (document.hidden && !fromOutput) return;
  if (renderer && (master.preview || (outputWindow && !outputWindow.closed)) && (renderDirty || playing || sources.some(s => s.dirty && s.values.opacity > 0))) {
    try {
      if (renderer.render(sources, master.values, mapping)) {
        renderDirty = false; frames++;
        // Explicit capture also works when the mixer canvas is covered by fullscreen output.
        if (outputStream) { renderer.gl.flush(); outputStream.getVideoTracks()[0]?.requestFrame?.(); }
      }
    }
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
function tick(now) {
  if (disposed) return;
  requestAnimationFrame(tick); renderFrame(now);
}
// Use the visible output window's clock when the mixer window is occluded.
window.addEventListener('mist-output-frame', e => {
  if (e.detail?.output !== outputWindow || !Number.isFinite(e.detail.time)) return;
  renderFrame(e.detail.time - performance.timeOrigin, true);
});
window.addEventListener('pagehide', () => {
  disposed = true; sources.forEach(disposeSource); stopOutputStream(); renderer?.dispose(); if (outputWindow && !outputWindow.closed) outputWindow.close();
});
const handles = [...document.querySelectorAll('.mapping-handle')];
function updateMapping() {
  $('#mapping-overlay').hidden = !mapping.editing || !master.preview;
  $('#reset-mapping').disabled = identityCorners(mapping.points);
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
$('#mapping-toggle').onchange = e => { mapping.editing = e.target.checked; updateMapping(); };
$('#reset-mapping').onclick = resetMapping;
handles.forEach((handle, index) => {
  let dragging = false;
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); handle.focus(); handle.setPointerCapture(e.pointerId); dragging = true;
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging || !mapping.editing) return;
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
updateMaster(); updateMapping(); updateRows(); requestAnimationFrame(tick);
