const KNOB_START = 6;
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export function controlNavigation(matrix) {
  let rows = [], selected = null, rowIndex = 0, preferredColumn = KNOB_START, moving = false;
  const available = control => control?.isConnected && !control.disabled && control.getClientRects().length > 0;
  const column = control => Number(control.dataset.navColumn);
  function controls(row) {
    return [...row.querySelectorAll('[data-nav-column]')].filter(available);
  }
  function closest(row, wanted) {
    return controls(row).sort((a, b) => Math.abs(column(a) - wanted) - Math.abs(column(b) - wanted) || column(a) - column(b))[0];
  }
  function mark(control) {
    selected?.classList.remove('control-selected');
    selected = control;
    selected?.classList.add('control-selected');
  }
  function select(control, rememberColumn = true) {
    if (!available(control)) return;
    rowIndex = rows.indexOf(control.closest('.matrix-row'));
    if (rememberColumn) preferredColumn = column(control);
    moving = true;
    control.focus({ preventScroll: true });
    mark(control);
    if (column(control) >= KNOB_START) control.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    else control.closest('.matrix-row').scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    moving = false;
  }
  function refresh() {
    rows = [...matrix.querySelectorAll('.matrix-row')];
    for (const row of rows) {
      const general = [
        row.querySelector('.preview-eye'),
        row.querySelector('.source-name'),
        row.querySelector('.transport .icon-button'),
        row.querySelector('.transport .icon-button:nth-child(2)'),
        row.querySelector('.transport .reset-button'),
        row.querySelector('.row-operations button'),
      ];
      general.forEach((control, index) => { if (control) control.dataset.navColumn = index; });
      row.querySelectorAll('.knob').forEach((control, index) => { control.dataset.navColumn = KNOB_START + index; });
    }
    if (selected && !selected.isConnected) {
      const row = rows[Math.min(rowIndex, rows.length - 1)];
      select(row && closest(row, preferredColumn), false);
    }
  }
  document.addEventListener('focusin', event => {
    if (moving) return;
    const target = event.target;
    const control = matrix.contains(target) ? target.closest('[data-nav-column]') || target.closest('.knob-cell')?.querySelector('.knob') : null;
    if (!control) { selected?.classList.remove('control-selected'); return; }
    rowIndex = rows.indexOf(control.closest('.matrix-row'));
    preferredColumn = column(control); mark(control);
  });
  document.addEventListener('keydown', event => {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || !ARROWS.has(event.key)) return;
    const active = document.activeElement;
    // Preserve text editing, selects, and controls outside the source matrix.
    if (active.matches('input, textarea, select') || active.isContentEditable) return;
    if (!matrix.contains(active) && active !== matrix.parentElement && active !== document.body && active !== document.documentElement) return;
    event.preventDefault(); event.stopPropagation();
    const current = active.closest?.('[data-nav-column]');
    if (!current || !available(current)) {
      select(available(selected) ? selected : closest(rows[0], KNOB_START)); return;
    }
    const row = current.closest('.matrix-row'), index = rows.indexOf(row);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const choices = controls(row).sort((a, b) => column(a) - column(b));
      const next = choices[choices.indexOf(current) + (event.key === 'ArrowRight' ? 1 : -1)];
      if (next) select(next);
    } else {
      const nextRow = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (nextRow) select(closest(nextRow, preferredColumn), false);
    }
  }, true);
  refresh();
  return { refresh };
}
