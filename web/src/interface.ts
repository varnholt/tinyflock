/** Presentation controls stay separate from simulation and camera state. */
export function installInterfaceToggle() {
  const hide = document.getElementById('hide-ui') as HTMLButtonElement;
  const restore = document.getElementById('show-ui') as HTMLButtonElement;
  let visible = true;
  const setVisible = (value: boolean) => {
    visible = value;
    document.body.dataset.interfaceHidden = String(!value);
    restore.hidden = value;
    if (!value && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  hide.addEventListener('click', () => setVisible(false));
  restore.addEventListener('click', () => setVisible(true));
  window.addEventListener('keydown', event => {
    const target = event.target;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
      (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, select, textarea')))) return;
    if (event.key.toLowerCase() === 'h') {
      event.preventDefault();
      setVisible(!visible);
    } else if (event.key === 'Escape') setVisible(true);
  });
  setVisible(new URLSearchParams(location.search).get('ui') !== 'hidden');
  return setVisible;
}
