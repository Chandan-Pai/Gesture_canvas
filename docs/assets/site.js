const INTRO_MS = 15_000;
const INTRO_KEY = 'gc-intro-seen';

export function initIntroCollapse() {
  const intro = document.getElementById('intro-panel');
  const compact = document.getElementById('compact-bar');
  if (!intro || !compact) return;

  function collapse() {
    intro.classList.replace('expanded', 'collapsed');
    compact.classList.replace('hidden', 'visible');
    try {
      localStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* private browsing */
    }
  }

  const skip = document.getElementById('skip-intro');
  skip?.addEventListener('click', collapse);

  if (localStorage.getItem(INTRO_KEY)) {
    collapse();
    return;
  }

  setTimeout(collapse, INTRO_MS);
}
