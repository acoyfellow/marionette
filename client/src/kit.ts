import type * as THREE from 'three';
import { mountTickerPanel } from './panel';
import { loop, makeScene, type Scene } from './scene';
import type { Ticker } from './ticker';

export type Control<Name extends string> =
  | { readonly kind: 'button'; readonly label: string; readonly event: Name }
  | {
      readonly kind: 'slider';
      readonly label: string;
      readonly input: string;
      readonly min: number;
      readonly max: number;
      readonly step: number;
      readonly initial: number;
    };

export type PageSpec<Output, Name extends string> = {
  readonly slug: string;
  readonly title: string;
  readonly topic: string;
  readonly lesson: string;
  readonly eye: THREE.Vector3Tuple;
  readonly make: () => Ticker<Output, Name>;
  readonly controls: readonly Control<Name>[];
  readonly view: (scene: Scene, ticker: Ticker<Output, Name>) => (frame: Output) => string;
};

export type AnyPage = PageSpec<never, string>;

export const definePage = <Output, Name extends string>(spec: PageSpec<Output, Name>) => spec as unknown as AnyPage;

const BUTTON =
  'pointer-events-auto rounded-md border border-white/15 bg-white/5 px-3 py-2 font-mono text-xs text-slate-100 active:bg-[#f6821f] active:text-black hover:border-[#f6821f]';

function mountControls<Output, Name extends string>(
  host: HTMLElement,
  spec: PageSpec<Output, Name>,
  ticker: Ticker<Output, Name>,
) {
  for (const control of spec.controls) {
    if (control.kind === 'button') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = BUTTON;
      button.textContent = control.label;
      button.dataset.event = control.event;
      button.addEventListener('click', () => ticker.press(control.event));
      host.appendChild(button);
      continue;
    }
    const label = document.createElement('label');
    label.className = 'pointer-events-auto flex items-center gap-2 font-mono text-xs text-slate-200';
    const name = document.createElement('span');
    name.textContent = control.label;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(control.min);
    range.max = String(control.max);
    range.step = String(control.step);
    range.value = String(control.initial);
    range.className = 'w-28 accent-[#f6821f]';
    range.dataset.input = control.input;
    ticker.set(control.input, control.initial);
    range.addEventListener('input', () => ticker.set(control.input, Number(range.value)));
    label.appendChild(name);
    label.appendChild(range);
    host.appendChild(label);
  }
}

export function mountPage<Output, Name extends string>(spec: PageSpec<Output, Name>, ui: PageUi) {
  const scene = makeScene(ui.canvas, spec.eye);
  const ticker = spec.make();
  ui.title.textContent = spec.title;
  ui.topic.textContent = spec.topic;
  ui.lesson.textContent = spec.lesson;
  mountControls(ui.controls, spec, ticker);
  const panelView = mountTickerPanel(ui.cells, ticker, spec.make, 'cells light up as they change');
  const draw = spec.view(scene, ticker);
  loop(() => {
    ui.caption.textContent = draw(ticker.step());
    panelView();
    scene.renderer.render(scene.scene, scene.camera);
  });
}

export type PageUi = {
  readonly canvas: HTMLCanvasElement;
  readonly title: HTMLElement;
  readonly topic: HTMLElement;
  readonly lesson: HTMLElement;
  readonly controls: HTMLElement;
  readonly cells: HTMLElement;
  readonly caption: HTMLElement;
};
