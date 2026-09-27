import '@prochia/ui/styles.css';
import './landing.css';
import { resetDemo, startDemo } from '../src/client';

const root = new URL('.', location.href);
const frames = [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-src]')];
const wide = window.matchMedia('(min-width: 1100px)');

/** The panel is laid out for a desktop; render it at 1280 px and scale it into its column. */
const desk = document.querySelector<HTMLElement>('[data-desk]')!;
const deskFrame = desk.querySelector('iframe')!;
new ResizeObserver(([entry]) => {
  const { width, height } = entry!.contentRect;
  const scale = Math.min(1, width / 1280);
  deskFrame.style.width = `${width / scale}px`;
  deskFrame.style.height = `${height / scale}px`;
  deskFrame.style.transform = `scale(${scale})`;
}).observe(desk);

const loadFrames = () => {
  if (!wide.matches) return;
  for (const f of frames) if (!f.src) f.src = f.dataset.src!;
};

document.querySelector('[data-reset]')!.addEventListener('click', async (e) => {
  const button = e.currentTarget as HTMLButtonElement;
  if (
    !confirm('همهٔ سفارش‌ها و تغییراتی که در این مرورگر داده‌اید پاک شود و داده‌های نمونه برگردد؟')
  )
    return;
  button.disabled = true;
  button.textContent = 'در حال بازنشانی…';
  await resetDemo();
  location.reload();
});

await startDemo(root);
loadFrames();
wide.addEventListener('change', loadFrames);
