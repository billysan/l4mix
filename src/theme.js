// Runs before styles load so a saved palette is applied before the first paint.
(() => {
  const colors = { classic: '#141414', dark: '#090a0c', sunset: '#1d1420', tropicana: '#1a1410' };
  const key = 'mist-theme';
  const valid = value => Object.hasOwn(colors, value) ? value : 'classic';
  function apply(value) {
    const theme = valid(value);
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', colors[theme]);
    const select = document.querySelector('#theme');
    if (select) select.value = theme;
  }
  let saved = 'classic';
  try { saved = localStorage.getItem(key); } catch { /* Themes still work when storage is unavailable. */ }
  apply(saved);
  document.addEventListener('DOMContentLoaded', () => {
    const select = document.querySelector('#theme'); select.value = document.documentElement.dataset.theme;
    select.addEventListener('change', () => {
      apply(select.value);
      try { localStorage.setItem(key, select.value); } catch { /* Keep the session choice. */ }
    });
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
