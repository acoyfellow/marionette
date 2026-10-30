import { Effect, Queue, Schema, Stream } from 'effect';
import { Runtime, Subscription } from 'foldkit';
import type { Html, HtmlBuilder } from 'foldkit/html';
import { defineMessageUnion } from 'foldkit/message';
import type { Frame, Stage } from './stage';

const Model = Schema.Struct({
  cells: Schema.Number,
  operations: Schema.Number,
  stepMicros: Schema.Number,
  selected: Schema.Number,
  dragging: Schema.Boolean,
  frames: Schema.Number,
});

type Model = typeof Model.Type;

const Message = defineMessageUnion({
  Framed: {
    stepMicros: Schema.Number,
    selected: Schema.Number,
    dragging: Schema.Boolean,
  },
});

type Message = typeof Message.Type;

const frames = (stage: Stage): Stream.Stream<Message> =>
  Stream.callback<Message>((queue) =>
    Effect.sync(() =>
      stage.onFrame((frame: Frame) => {
        Queue.offerUnsafe(
          queue,
          Message.Framed({
            stepMicros: frame.stepMicros,
            selected: frame.output.cubes.filter((cube) => cube.selected === 1).length,
            dragging: frame.output.dragging === 1,
          }),
        );
      }),
    ).pipe(Effect.andThen(Effect.never)),
  );

const stat = (h: HtmlBuilder<Message>, label: string, value: string): Html =>
  h.div(
    [h.Class('flex flex-col')],
    [
      h.span([h.Class('text-[10px] uppercase tracking-[0.18em] text-slate-400')], [label]),
      h.span([h.Class('font-mono text-sm text-slate-50')], [value]),
    ],
  );

const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class(
        'pointer-events-none flex flex-wrap items-end gap-6 rounded-xl border border-white/10 bg-[#111a24]/80 px-5 py-4 backdrop-blur',
      ),
    ],
    [
      h.div(
        [h.Class('mr-4')],
        [
          h.h1([h.Class('text-lg font-extrabold tracking-tight text-[#f6821f]')], ['marionette']),
          h.p(
            [h.Class('text-xs text-slate-400')],
            ['a hand-wired network: sums + ReLUs, no ifs · three.js only draws'],
          ),
        ],
      ),
      stat(h, 'program', `${model.cells} cells · ${model.operations} ops`),
      stat(h, 'per second', `${Math.round((model.operations * 60) / 1000)}k ops at 60 fps`),
      stat(h, 'step', `${model.stepMicros} µs`),
      stat(h, 'selected', String(model.selected)),
      stat(h, 'frames', String(model.frames)),
    ],
  );

export function mountHud(container: HTMLElement, stage: Stage) {
  const runtime = Runtime.makeElement({
    Model,
    init: () => ({
      model: {
        cells: stage.puppeteer.size.cells,
        operations: stage.puppeteer.size.operations,
        stepMicros: 0,
        selected: 0,
        dragging: false,
        frames: 0,
      },
    }),
    update: (model: Model, message: Message) => ({
      model: {
        ...model,
        stepMicros: message.stepMicros,
        selected: message.selected,
        dragging: message.dragging,
        frames: model.frames + 1,
      },
    }),
    view,
    subscriptions: Subscription.make<Model, Message, never>()((entry) => ({
      frames: entry(
        { on: Schema.Boolean },
        {
          modelToDependencies: () => ({ on: true }),
          dependenciesToStream: () => frames(stage),
        },
      ),
    })),
    container,
  });

  Runtime.run(runtime);
}
