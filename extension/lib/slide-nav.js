/**
 * Dispatch a single presentation navigation key (Google Slides, PowerPoint web, etc.)
 */

/** @param {'next' | 'prev'} direction */
export function dispatchSlideNavigation(direction) {
  const isNext = direction === 'next';
  const labels = isNext
    ? ['next slide', 'go to next']
    : ['previous slide', 'go to previous'];

  for (const btn of document.querySelectorAll(
    'button[aria-label], [role="button"][aria-label], [data-tooltip]',
  )) {
    const label = (
      btn.getAttribute('aria-label') ||
      btn.getAttribute('data-tooltip') ||
      ''
    ).toLowerCase();
    if (labels.some((needle) => label.includes(needle))) {
      btn.click();
      return;
    }
  }

  const target = document.activeElement || document.body;
  const spec = isNext
    ? { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }
    : { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 };
  const init = {
    ...spec,
    which: spec.keyCode,
    bubbles: true,
    cancelable: true,
  };
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
}
