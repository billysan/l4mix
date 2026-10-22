const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export function controlNavigation(matrix, channels) {
  let selected = null, previousIndex = 0, preferred = 0, moving = false;
  const available = control => control?.isConnected && !control.disabled && control.getClientRects().length > 0;
  const ownerOf = control => channels.owners().find(owner => owner.row.contains(control));
  const controls = owner => [...owner.row.querySelectorAll('[data-nav-column]')].filter(available);
  function mark(control) {
    selected?.classList.remove('control-selected'); selected = control;
    selected?.classList.add('control-selected');
  }
  function select(control, remember = true) {
    if (!available(control)) return;
    const owner = ownerOf(control); channels.selectChannel(owner);
    previousIndex = channels.owners().indexOf(owner);
    if (remember) preferred = Number(control.dataset.navColumn);
    moving = true; control.focus({ preventScroll: true }); mark(control);
    control.scrollIntoView({ block: 'nearest', inline: 'nearest' }); moving = false;
  }
  function closest(owner, column) {
    return controls(owner).sort((a, b) => Math.abs(Number(a.dataset.navColumn) - column) - Math.abs(Number(b.dataset.navColumn) - column))[0];
  }
  function refresh() {
    for (const owner of channels.owners()) {
      const row = owner.row;
      const general = [row.querySelector('.preview-eye'), row.querySelector('.channel-select'), row.querySelector('.transport .icon-button'), row.querySelector('.transport .icon-button:nth-child(2)'), row.querySelector('.reset-button'), row.querySelector('.row-operations button')];
      general.forEach((control, index) => { if (control) control.dataset.navColumn = index; });
      row.querySelectorAll('.knob').forEach((control, index) => { control.dataset.navColumn = 6 + index; });
    }
    if (selected && !selected.isConnected) {
      const owner = channels.owners()[Math.min(previousIndex, channels.owners().length - 1)];
      channels.selectChannel(owner); select(closest(owner, preferred), false);
    }
  }
  document.addEventListener('focusin', event => {
    if (moving) return;
    const control = matrix.contains(event.target) ? event.target.closest('[data-nav-column]') || event.target.closest('.knob-cell')?.querySelector('.knob') : null;
    if (!control) { selected?.classList.remove('control-selected'); return; }
    const owner = ownerOf(control); channels.selectChannel(owner);
    previousIndex = channels.owners().indexOf(owner); preferred = Number(control.dataset.navColumn); mark(control);
  });
  document.addEventListener('keydown', event => {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || !ARROWS.has(event.key)) return;
    const active = document.activeElement;
    if (active.matches('input, textarea, select') || active.isContentEditable) return;
    if (!matrix.contains(active) && active !== matrix.parentElement && active !== document.body && active !== document.documentElement) return;
    event.preventDefault(); event.stopPropagation();
    const current = active.closest?.('[data-nav-column]');
    if (!current || !available(current)) { select(closest(channels.selected(), 6)); return; }
    const owner = ownerOf(current);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const choices = controls(owner);
      const next = choices[choices.indexOf(current) + (event.key === 'ArrowRight' ? 1 : -1)];
      if (next) select(next);
    } else {
      const owners = channels.owners(), next = owners[owners.indexOf(owner) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) { channels.selectChannel(next); select(closest(next, preferred), false); }
    }
  }, true);
  refresh(); return { refresh };
}
