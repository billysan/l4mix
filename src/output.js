const video = document.querySelector('video');
const error = document.querySelector('#error');
async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { document.querySelector('#hint').textContent = 'Fullscreen unavailable. Use your browser’s fullscreen command.'; }
}
document.querySelector('#fullscreen').addEventListener('click', fullscreen);
video.addEventListener('dblclick', fullscreen);
let hintTimer;
document.addEventListener('pointermove', () => {
  document.querySelector('#hint').style.opacity = '1';
  clearTimeout(hintTimer); hintTimer = setTimeout(() => { document.querySelector('#hint').style.opacity = '0'; }, 2500);
});
window.setMixerStream = async stream => {
  video.srcObject = stream;
  error.hidden = true;
  try { await video.play(); }
  catch { error.hidden = false; error.textContent = 'Click the picture to start output.'; video.onclick = () => { video.play().then(() => { error.hidden = true; }).catch(() => {}); }; }
};
window.addEventListener('pagehide', () => { video.srcObject = null; });
if (window.opener && !window.opener.closed) {
  try { window.opener.dispatchEvent(new CustomEvent('mist-output-ready', { detail: window })); }
  catch { error.hidden = false; error.textContent = 'Open this window using “Open clean output” in the mixer.'; }
} else { error.hidden = false; error.textContent = 'Open this window using “Open clean output” in the mixer.'; }
