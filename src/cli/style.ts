/**
 * Color in the terminal (4.1): whether to paint, and painting with ANSI codes by hand (no
 * dependency). The core never colors; only src/cli/ does, and --json and stderr stay plain.
 */

const CODES = { bold: 1, dim: 2, red: 31, green: 32, yellow: 33, blue: 34, cyan: 36, gray: 90 } as const;
export type Style = keyof typeof CODES;

/**
 * Whether ob paints its output: NO_COLOR (not empty) turns it off (https://no-color.org);
 * FORCE_COLOR (anything but "", "0" or "false") turns it on, even when piped; otherwise only in a
 * terminal whose TERM is not dumb.
 */
export function colorEnabled(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  if (env['NO_COLOR'] !== undefined && env['NO_COLOR'] !== '') return false;
  const force = env['FORCE_COLOR'];
  if (force !== undefined) return !['', '0', 'false'].includes(force);
  return isTTY && env['TERM'] !== 'dumb';
}

/** text wrapped in the style's codes when on and text isn't empty; otherwise text unchanged. */
export function paint(on: boolean | undefined, style: Style | Style[], text: string): string {
  if (!on || text === '') return text;
  const codes = (Array.isArray(style) ? style : [style]).map(s => CODES[s]).join(';');
  return `\x1b[${codes}m${text}\x1b[0m`;
}

/** A status's color; they match the board's columns. */
export const STATUS_STYLE: Record<'todo' | 'doing' | 'done', Style> = { todo: 'gray', doing: 'blue', done: 'green' };

/** Removes the codes paint adds; for tests. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- matching the escape codes is the point
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** A line cut to a terminal's width with "…" (whole characters); unchanged when piped. */
export function fit(line: string, columns: number | undefined): string {
  const chars = [...line];
  if (columns === undefined || chars.length <= columns) return line;
  return chars.slice(0, Math.max(1, columns - 1)).join('').trimEnd() + '…';
}

/** One piece of a row, and its style (none for padding, so colors never run into the gaps). */
export interface Segment { text: string; style?: Style | Style[] }

/**
 * A row of segments, cut to the terminal's width exactly as fit() cuts the plain text, then
 * painted. Cutting first keeps a cut from landing inside an escape code.
 */
export function fitSegments(segments: Segment[], columns: number | undefined, on: boolean | undefined): string {
  const plain = segments.map(s => s.text).join('');
  const cut = fit(plain, columns);
  if (!on) return cut;
  const wasCut = cut !== plain;
  let keep = [...cut].length - (wasCut ? 1 : 0);
  let out = '';
  for (const s of segments) {
    if (keep <= 0) break;
    const chars = [...s.text];
    const taken = chars.slice(0, keep).join('');
    keep -= Math.min(keep, chars.length);
    out += s.style ? paint(true, s.style, taken) : taken;
  }
  return wasCut ? out + '…' : out;
}
