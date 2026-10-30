import type { Stage } from './stage';
import { identical, replay } from './strings';

const SIZE = 14;
const GAP = 3;
const LABEL = 64;
const FADE = 0.92;

const heat = (change: number) => {
  const t = Math.min(1, change);
  const r = Math.round(30 + 216 * t);
  const g = Math.round(42 + 88 * t);
  const b = Math.round(56 - 25 * t);
  return `rgb(${r},${g},${b})`;
};

export function mountCells(panel: HTMLElement, stage: Stage) {
  const { layout } = stage.puppeteer;
  const widest = Math.max(...layout.map((group) => group.wires.length));
  const canvas = document.createElement('canvas');
  const ratio = Math.min(devicePixelRatio, 2);
  const width = LABEL + widest * (SIZE + GAP);
  const height = layout.length * (SIZE + GAP);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.scale(ratio, ratio);

  const status = document.createElement('p');
  status.className = 'font-mono text-[11px] text-slate-400';
  status.textContent = 'every cell of state, lit when it changes';

  const button = document.createElement('button');
  button.type = 'button';
  button.className =
    'pointer-events-auto rounded-md border border-white/15 px-3 py-1 font-mono text-xs text-slate-100 hover:border-[#f6821f]';
  button.textContent = 'replay from inputs only';
  button.addEventListener('click', () => {
    const journal = stage.puppeteer.journal();
    const started = performance.now();
    const rebuilt = replay(journal);
    const ms = (performance.now() - started).toFixed(1);
    const same = identical(rebuilt, stage.puppeteer.snapshot());
    status.textContent = same
      ? `✓ ${journal.length} frames replayed in ${ms} ms: all ${rebuilt.length} cells identical, bit for bit`
      : `✗ replay diverged after ${journal.length} frames`;
    status.className = `font-mono text-[11px] ${same ? 'text-emerald-300' : 'text-rose-300'}`;
  });

  panel.appendChild(canvas);
  panel.appendChild(button);
  panel.appendChild(status);

  let previous = stage.puppeteer.snapshot();
  const glow = new Float32Array(previous.length);

  const draw = () => {
    const current = stage.puppeteer.snapshot();
    context.clearRect(0, 0, width, height);
    context.font = '10px ui-monospace, monospace';
    context.textBaseline = 'middle';
    layout.forEach((group, row) => {
      const y = row * (SIZE + GAP);
      context.fillStyle = '#94a3b8';
      context.fillText(group.label, 0, y + SIZE / 2);
      group.wires.forEach((wire, column) => {
        const change = Math.abs((current[wire] ?? 0) - (previous[wire] ?? 0));
        glow[wire] = Math.max((glow[wire] ?? 0) * FADE, change > 1e-6 ? 1 : 0);
        context.fillStyle = heat(glow[wire] ?? 0);
        context.fillRect(LABEL + column * (SIZE + GAP), y, SIZE, SIZE);
      });
    });
    previous = current;
  };

  stage.onFrame(draw);
  const idle = () => {
    draw();
    requestAnimationFrame(idle);
  };
  requestAnimationFrame(idle);
}
