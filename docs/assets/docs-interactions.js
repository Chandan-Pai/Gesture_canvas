/**
 * visionOS-style interactions for docs site.
 */
const SPRING = 'cubic-bezier(0.34, 1.2, 0.64, 1)';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initDocsInteractions() {
  initNavScroll();
  initScrollReveal();
  initHeroSpotlight();
  initButtonPress();
  initFeedbackSticky();
}

function initNavScroll() {
  const wrap = document.getElementById('gc-header');
  if (!wrap) return;
  const header = wrap.querySelector('header');
  if (!header) return;
  header.classList.add('glass-nav');

  const onScroll = () => {
    header.classList.toggle('glass-nav--scrolled', window.scrollY > 32);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

function initScrollReveal() {
  const nodes = document.querySelectorAll('.reveal, .glass-card, .glass-panel-block');
  if (!nodes.length) return;

  if (reducedMotion()) {
    nodes.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  nodes.forEach((el, i) => {
    el.classList.add('reveal');
    el.style.setProperty('--reveal-delay', `${Math.min(i % 4, 3) * 80}ms`);
    io.observe(el);
  });
}

function initHeroSpotlight() {
  const hero = document.querySelector('[data-hero-spotlight]');
  if (!hero || reducedMotion()) return;

  const spot = document.createElement('div');
  spot.className = 'hero-spotlight';
  spot.setAttribute('aria-hidden', 'true');
  hero.appendChild(spot);

  hero.addEventListener('mousemove', (e) => {
    const rect = hero.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    spot.style.setProperty('--spot-x', `${x}%`);
    spot.style.setProperty('--spot-y', `${y}%`);
  }, { passive: true });

  hero.addEventListener('mouseleave', () => {
    spot.style.setProperty('--spot-x', '50%');
    spot.style.setProperty('--spot-y', '40%');
  }, { passive: true });
}

function initButtonPress() {
  document.querySelectorAll('.btn-gold, .btn-feedback, .btn-glass, .glass-nav .gold-glow, .glass-nav .feedback-glow').forEach((btn) => {
    btn.classList.add('btn-press');
  });
}

export function initFeedbackSticky() {
  const sticky = document.getElementById('feedback-sticky');
  if (!sticky) return;

  sticky.style.transition = `transform 0.5s ${SPRING}, opacity 0.4s ease`;

  function show() {
    sticky.classList.add('visible');
  }

  if (window.scrollY > 200) show();
  else {
    window.addEventListener('scroll', function onScroll() {
      if (window.scrollY > 200) {
        show();
        window.removeEventListener('scroll', onScroll);
      }
    }, { passive: true });
  }

  setTimeout(show, 8000);
}
