// Landing page motion. Content is complete without this script: it only adds staged entrances,
// the hero receipt sequence and the graph drawing, and all of it respects reduced motion.
import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/geist-mono/index.css';
import './landing.css';

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.add('js');

// Staged entrances: siblings inside a section enter 100ms apart, once.
const reveals = [...document.querySelectorAll<HTMLElement>('.reveal')];
const groups = new Map<Element, number>();
for (const el of reveals) {
  const parent = el.parentElement!;
  const i = groups.get(parent) ?? 0;
  el.style.setProperty('--i', String(Math.min(i, 5)));
  groups.set(parent, i + 1);
}
if (calm || !('IntersectionObserver' in window)) {
  for (const el of reveals) el.classList.add('in');
} else {
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        seen.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );
  for (const el of reveals) seen.observe(el);
}

// The hero receipt: each code lands, the total counts down, then the loss and the fix appear.
const receipt = document.querySelector<HTMLElement>('.receipt');
if (receipt) {
  const codes = [...receipt.querySelectorAll<HTMLElement>('.receipt-codes li')];
  const net = receipt.querySelector<HTMLElement>('.receipt-net')!;
  const steps = [10000, 8000, 6800, 6000];
  const show = (cents: number) => (net.textContent = `$${(cents / 100).toFixed(2)}`);

  const finalState = () => {
    for (const li of codes) li.classList.add('on');
    show(steps[3]);
    receipt.classList.add('done');
  };

  if (calm) finalState();
  else {
    let timers: number[] = [];
    let running = false;
    const countTo = (from: number, to: number) => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / 450);
        show(Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
        if (t < 1 && running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    const play = () => {
      running = true;
      receipt.classList.remove('done');
      for (const li of codes) li.classList.remove('on');
      show(steps[0]);
      codes.forEach((li, i) => {
        timers.push(window.setTimeout(() => {
          li.classList.add('on');
          countTo(steps[i], steps[i + 1]);
        }, 700 + i * 900));
      });
      timers.push(window.setTimeout(() => receipt.classList.add('done'), 700 + codes.length * 900 + 200));
      timers.push(window.setTimeout(play, 9000));
    };
    const stop = () => {
      running = false;
      timers.forEach(clearTimeout);
      timers = [];
    };
    // Plays only while on screen and the tab is visible.
    new IntersectionObserver(([e]) => (e.isIntersecting && !document.hidden ? (running || play()) : stop())).observe(receipt);
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : running || play()));
  }
}
