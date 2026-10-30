import { identical, replayTicker, type Ticker } from './ticker';

const SIZE = 14;
const GAP = 3;
const LABEL = 64;

const heat = (glow: number) =>
  `rgb(${Math.round(30 + 216 * glow)},${Math.round(42 + 88 * glow)},${Math.round(56 - 25 * glow)})`;

export function mountTickerPanel<Output, Name extends string>(
  panel: HTMLElement,
  ticker: Ticker<Output, Name>,
  make: () => Ticker<Output, Name>,
  hint: string,
): () => void {
  const { layout } = ticker;
  const widest = Math.max(...layout.map((group) => group.wires.length));
  const width = LABEL + widest * (SIZE + GAP);
  const height = layout.length * (SIZE + GAP);
  const canvas = document.createElement('canvas');
  const ratio = Math.min(devicePixelRatio, 2);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d');

  const title = document.createElement('p');
  title.className = 'font-mono text-[11px] text-slate-300';
  title.textContent = `${ticker.size.cells} cells · ${ticker.size.operations} ops · ${hint}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className =
    'pointer-events-auto rounded-md border border-white/15 px-3 py-1 font-mono text-xs text-slate-100 hover:border-[#f6821f]';
  button.textContent = 'replay from inputs only';
  const status = document.createElement('p');
  status.className = 'font-mono text-[11px] text-slate-400';
  status.textContent = 'every cell of state, lit when it changes';
  button.addEventListener('click', () => {
    const journal = ticker.journal();
    const started = performance.now();
    const rebuilt = replayTicker(make, journal);
    const ms = (performance.now() - started).toFixed(1);
    const same = identical(rebuilt, ticker.snapshot());
    status.textContent = same
      ? `✓ ${journal.length} frames replayed in ${ms} ms: all ${rebuilt.length} cells identical`
      : `✗ replay diverged after ${journal.length} frames`;
    status.className = `font-mono text-[11px] ${same ? 'text-emerald-300' : 'text-rose-300'}`;
  });
  panel.appendChild(title);
  panel.appendChild(canvas);
  panel.appendChild(button);
  panel.appendChild(status);

  let previous = ticker.snapshot();
  const glow = new Float32Array(previous.length);
  return () => {
    if (context === null) return;
    const current = ticker.snapshot();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.font = '10px ui-monospace, monospace';
    context.textBaseline = 'middle';
    layout.forEach((group, row) => {
      const y = row * (SIZE + GAP);
      context.fillStyle = '#94a3b8';
      context.fillText(group.label, 0, y + SIZE / 2);
      group.wires.forEach((wire, column) => {
        const change = Math.abs((current[wire] ?? 0) - (previous[wire] ?? 0));
        glow[wire] = Math.max((glow[wire] ?? 0) * 0.9, Math.min(1, change * 40));
        context.fillStyle = heat(glow[wire] ?? 0);
        context.fillRect(LABEL + column * (SIZE + GAP), y, SIZE, SIZE);
      });
    });
    previous = current;
  };
}
