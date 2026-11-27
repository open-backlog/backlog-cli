import { describe, expect, it } from 'vitest';

import { colorEnabled, fit, fitSegments, paint, stripAnsi } from '../src/cli/style.js';

/** Color in the terminal (4.1.1): when ob paints, and how a painted row is cut. */
describe('colorEnabled', () => {
  it.each([
    [{}, true, true],
    [{}, false, false],
    [{ NO_COLOR: '1' }, true, false],
    [{ NO_COLOR: '' }, true, true],
    [{ FORCE_COLOR: '1' }, false, true],
    [{ FORCE_COLOR: '0' }, false, false],
    [{ FORCE_COLOR: 'false' }, true, false],
    [{ FORCE_COLOR: '' }, true, false],
    [{ NO_COLOR: '1', FORCE_COLOR: '1' }, true, false],
    [{ TERM: 'dumb' }, true, false],
    [{ TERM: 'dumb', FORCE_COLOR: '1' }, false, true],
  ] as [NodeJS.ProcessEnv, boolean, boolean][])('%o in a terminal: %s → %s', (env, tty, want) => {
    expect(colorEnabled(env, tty)).toBe(want);
  });
});

describe('paint and fitSegments', () => {
  it('paints only when on and only non-empty text', () => {
    expect(paint(true, 'blue', 'doing')).toBe('\x1b[34mdoing\x1b[0m');
    expect(paint(true, ['bold', 'red'], 'x')).toBe('\x1b[1;31mx\x1b[0m');
    expect(paint(false, 'blue', 'doing')).toBe('doing');
    expect(paint(undefined, 'blue', 'doing')).toBe('doing');
    expect(paint(true, 'blue', '')).toBe('');
    expect(stripAnsi(paint(true, 'gray', 'todo'))).toBe('todo');
  });

  const row = [{ text: '1.2.1', style: 'bold' as const }, { text: '  ' }, { text: 'doing', style: 'blue' as const }, { text: '  ' }, { text: 'Card form ✓ émoji' }];
  const plain = row.map(s => s.text).join('');

  it('cuts like fit at every width, and never inside a code', () => {
    for (let columns = 1; columns <= plain.length + 2; columns++) {
      const out = fitSegments(row, columns, true);
      expect(stripAnsi(out), String(columns)).toBe(fit(plain, columns));
      // eslint-disable-next-line no-control-regex -- counting escape codes
      expect((out.match(/\x1b\[(?!0m)[0-9;]*m/g) ?? []).length, String(columns)).toBe((out.match(/\x1b\[0m/g) ?? []).length);
    }
    expect(fitSegments(row, undefined, true)).toBe('\x1b[1m1.2.1\x1b[0m  \x1b[34mdoing\x1b[0m  Card form ✓ émoji');
    expect(fitSegments(row, 9, true)).toBe('\x1b[1m1.2.1\x1b[0m  \x1b[34md\x1b[0m…');
  });

  it('with color off is fit of the plain text', () => {
    expect(fitSegments(row, 12, false)).toBe(fit(plain, 12));
    expect(fitSegments(row, undefined, false)).toBe(plain);
  });
});
