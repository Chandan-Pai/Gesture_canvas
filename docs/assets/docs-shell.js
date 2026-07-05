/**
 * Shared nav + footer for docs site. Set data-docs-base on <body> if needed (default: auto).
 * data-docs-page: home | extension | feedback
 */
export function docsBase() {
  const attr = document.body?.dataset?.docsBase;
  if (attr !== undefined) return attr;
  const path = window.location.pathname;
  if (/\/(extension|feedback|app)\//.test(path)) return '../';
  return '';
}

export function renderDocsShell() {
  const base = docsBase();
  const page = document.body?.dataset?.docsPage || '';
  const headerEl = document.getElementById('gc-header');
  const footerEl = document.getElementById('gc-footer');
  if (!headerEl || !footerEl) return;

  const navLink = (href, label, active) => {
    const cls = active
      ? 'text-primary-fixed-dim'
      : 'text-on-surface-variant hover:text-primary-fixed-dim transition-colors';
    return `<a class="${cls} text-label-caps uppercase tracking-wider" href="${base}${href}">${label}</a>`;
  };

  headerEl.innerHTML = `
    <header class="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-container-padding h-toolbar-width glass-panel bg-surface/40 border-b border-white/5">
      <a href="${base || './'}" class="flex items-center gap-4">
        <div class="w-8 h-8 bg-primary-fixed rounded-full flex items-center justify-center">
          <span class="material-symbols-outlined text-on-primary text-xl" style="font-variation-settings: 'FILL' 1;">back_hand</span>
        </div>
        <span class="text-label-caps text-primary-fixed-dim tracking-[0.2em] uppercase">Gesture Canvas</span>
      </a>
      <div class="flex items-center gap-6">
        <nav class="hidden md:flex items-center gap-6">
          ${navLink('extension/', 'Extension', page === 'extension')}
          ${navLink(page === 'home' ? '#gestures' : '../#gestures', 'Gestures', false)}
          ${navLink('feedback/', 'Feedback', page === 'feedback')}
        </nav>
        <a href="${base}app/" class="hidden sm:inline-block bg-primary-fixed-dim text-on-primary-fixed px-6 py-2.5 rounded-full text-label-caps uppercase tracking-wider hover:bg-primary-fixed transition-all gold-glow">
          Open Demo
        </a>
        <a href="${base}feedback/" class="bg-feedback text-white px-6 py-2.5 rounded-full text-label-caps uppercase tracking-wider hover:opacity-90 transition-all feedback-glow">
          Feedback
        </a>
      </div>
    </header>`;

  footerEl.innerHTML = `
    <footer class="border-t border-white/5 bg-surface-container-lowest py-16 px-container-padding pb-28 mt-auto">
      <div class="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
        <div class="flex items-center gap-4">
          <div class="w-6 h-6 bg-primary-fixed/20 rounded-full flex items-center justify-center">
            <span class="material-symbols-outlined text-primary-fixed-dim text-sm" style="font-variation-settings: 'FILL' 1;">back_hand</span>
          </div>
          <span class="text-label-caps text-on-surface-variant tracking-widest uppercase">Gesture Canvas</span>
        </div>
        <div class="flex flex-wrap justify-center gap-8">
          <a class="text-label-sm text-on-surface-variant hover:text-on-surface transition-colors" href="${base}feedback/">Feedback</a>
          <a class="text-label-sm text-on-surface-variant hover:text-on-surface transition-colors" href="${base}companion/">Companion</a>
          <a class="text-label-sm text-on-surface-variant hover:text-on-surface transition-colors" href="https://github.com/Chandan-Pai/Gesture_canvas" target="_blank" rel="noopener">GitHub</a>
          <a class="text-label-sm text-on-surface-variant hover:text-on-surface transition-colors" href="https://forms.gle/wXJsxHMW4CyVTy3e8" target="_blank" rel="noopener">Google Form</a>
        </div>
        <p class="text-label-sm text-on-surface-variant opacity-50">© 2026 Gesture Canvas · MediaPipe Hands</p>
      </div>
    </footer>`;
}
