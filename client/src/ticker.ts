import { createEvaluator, type createSourceTable, type WireValues } from 'handwired/src/runtime/cells.ts';
import type { Circuit, Wire } from 'handwired/src/runtime/numeric-ui-core.ts';
import { emitCompare, emitMaximum, emitMinimum, emitRelu } from 'handwired/src/runtime/numeric-ui-core.ts';

export const DT = 1 / 60;

export type CellGroup = { readonly label: string; readonly wires: readonly number[] };

export type TickProgram<Output, Name extends string> = {
  readonly circuit: Circuit;
  readonly nextSource: readonly Wire[];
  readonly initialSource: Float32Array;
  readonly validate: (source: Float32Array) => void;
  readonly output: Output;
  readonly events: Record<Name, Wire>;
  readonly dt: Wire;
  readonly inputs?: Record<string, Wire>;
  readonly layout: readonly CellGroup[];
};

export type JournalEntry<Name extends string> = { readonly fired: readonly Name[]; readonly values: Record<string, number> };

export type Ticker<Output, Name extends string> = {
  readonly press: (name: Name) => void;
  readonly set: (name: string, value: number) => void;
  readonly step: () => Output;
  readonly size: { readonly cells: number; readonly operations: number };
  readonly snapshot: () => Float32Array;
  readonly journal: () => readonly JournalEntry<Name>[];
  readonly layout: readonly CellGroup[];
};

export function createTicker<Output, Name extends string>(
  program: TickProgram<Output, Name>,
): Ticker<WireValues<Output>, Name> {
  const evaluate = createEvaluator(program as never) as (source: Float32Array) => {
    nextValues: Float32Array;
    output: WireValues<Output>;
  };
  const source = new Float32Array(program.initialSource);
  const entries: JournalEntry<Name>[] = [];
  const inputs = program.inputs ?? {};
  const values: Record<string, number> = Object.fromEntries(Object.entries(inputs).map(([k, w]) => [k, source[w] ?? 0]));
  let pending: Name[] = [];
  return {
    press: (name) => {
      pending.push(name);
    },
    set: (name, value) => {
      if (name in values) values[name] = value;
    },
    step: () => {
      const fired = pending;
      pending = [];
      entries.push({ fired, values: { ...values } });
      for (const wire of Object.values(program.events) as Wire[]) source[wire] = 0;
      for (const name of fired) source[program.events[name]] = 1;
      for (const [name, wire] of Object.entries(inputs)) source[wire] = values[name] ?? 0;
      source[program.dt] = DT;
      const result = evaluate(source);
      source.set(result.nextValues);
      return result.output;
    },
    size: { cells: source.length, operations: program.circuit.operations.length },
    snapshot: () => new Float32Array(source),
    journal: () => entries,
    layout: program.layout,
  };
}

export function replayTicker<Output, Name extends string>(
  make: () => Ticker<Output, Name>,
  journal: readonly JournalEntry<Name>[],
): Float32Array {
  const fresh = make();
  for (const { fired, values } of journal) {
    fired.forEach(fresh.press);
    for (const [name, value] of Object.entries(values)) fresh.set(name, value);
    fresh.step();
  }
  return fresh.snapshot();
}

export const identical = (a: Float32Array, b: Float32Array) =>
  a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

export const wiresOf = (value: unknown): number[] =>
  typeof value === 'number' ? [value] : Object.values(value as object).flatMap(wiresOf);

export function gates(circuit: Circuit) {
  const all = (...bits: Wire[]) =>
    circuit.reglu([], 1, bits.map((bit) => [bit, 1] as const), 1 - bits.length);
  const not = (bit: Wire) => circuit.affine([[bit, -1]], 1);
  const is = (value: Wire, k: number) => emitCompare(circuit, value, '===', circuit.constant(k));
  const atLeast = (value: Wire, limit: Wire) => emitCompare(circuit, value, '>=', limit);
  const below = (value: Wire, limit: number) => emitCompare(circuit, value, '<', circuit.constant(limit));
  const above = (value: Wire, limit: number) => emitCompare(circuit, value, '>', circuit.constant(limit));
  const unit = (value: Wire) => emitMinimum(circuit, circuit.constant(1), emitRelu(circuit, value));
  const either = (a: Wire, b: Wire) => emitMaximum(circuit, a, b);
  return { all, not, is, atLeast, below, above, unit, either };
}

export type SourceTable = ReturnType<typeof createSourceTable>;
