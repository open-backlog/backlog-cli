import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { isMap, isScalar, parseDocument, stringify } from 'yaml';

import type { Item, ItemFolder } from './types.js';
import { BacklogError } from './types.js';
import { parseMapping, TEXT_FIELDS } from './yaml.js';

/** A value a tool can write into front matter. */
export type FieldValue = string | number | boolean | string[];

const STORY_LEVEL = ['story', 'bug', 'spike', 'task'];

/**
 * Changes front-matter fields in an item file's text and returns the new text. Only the
 * characters of each changed value move: every other byte (unknown fields, their order, YAML
 * comments, quoting, blank lines, the body, line endings) stays as it was ([keep-unknown]).
 *
 *   value       the field is set: its value is replaced in place, or a new line is added at the
 *               end of the front matter
 *   undefined   the field's line is removed
 *
 * A value equal to what the file already says is left alone, so saving an unchanged item gives
 * the same bytes. Throws if the text has no front matter or it isn't a mapping.
 */
export function setFields(text: string, changes: Record<string, FieldValue | undefined>): string {
  let out = text;
  for (const [key, value] of Object.entries(changes)) out = setField(out, key, value);
  return out;
}

function setField(text: string, key: string, value: FieldValue | undefined): string {
  const fm = frontMatter(text);
  const doc = parseDocument(fm.yaml);
  if (doc.errors.length) throw new Error(`front matter is not valid YAML: ${doc.errors[0]?.message.split('\n')[0]}`);
  if (doc.contents !== null && !isMap(doc.contents)) throw new Error('front matter is not a YAML mapping');
  const pair = doc.contents?.items.find(p => isScalar(p.key) && String(p.key.value) === key);
  const at = (offset: number) => fm.start + offset;

  if (!pair) {
    if (value === undefined) return text;
    return text.slice(0, fm.end) + `${key}: ${formatValue(key, value)}${fm.eol}` + text.slice(fm.end);
  }

  const keyStart = (pair.key as { range?: [number, number, number] }).range?.[0] ?? 0;
  const node = pair.value as { range?: [number, number, number] } | null;
  if (value !== undefined && node?.range && isDeepStrictEqual(currentValue(fm.yaml, key), value)) return text;

  if (value === undefined) {
    // From the start of the key's line to the end of its value's last line.
    const lineStart = fm.yaml.lastIndexOf('\n', keyStart - 1) + 1;
    const end = lineEnd(fm.yaml, node?.range ? node.range[1] : keyStart);
    return text.slice(0, at(lineStart)) + text.slice(at(end));
  }
  if (node?.range && node.range[1] > node.range[0]) {
    // Replace just the value's characters; a comment after it on the line stays.
    return text.slice(0, at(node.range[0])) + formatValue(key, value) + text.slice(at(node.range[1]));
  }
  // An empty value (`key:`): write the value after the colon.
  const colon = fm.yaml.indexOf(':', keyStart);
  return text.slice(0, at(colon + 1)) + ' ' + formatValue(key, value) + text.slice(at(colon + 1)).replace(/^[ \t]+/, '');
}

/** What the front matter currently says for a field, read as ob reads it. */
function currentValue(yaml: string, key: string): unknown {
  return parseMapping(yaml)?.[key];
}

/** Where the front matter's YAML is inside a file's text, and the file's line ending. */
function frontMatter(text: string): { start: number; end: number; yaml: string; eol: string } {
  const open = /^---[ \t]*(\r?\n)/.exec(text);
  if (!open) throw new Error('has no front matter: it must start with a "---" line');
  const start = open[0].length;
  const close = /^---[ \t]*(?:\r?\n|$)/m.exec(text.slice(start));
  if (!close) throw new Error('front matter has no closing "---" line');
  const end = start + close.index;
  return { start, end, yaml: text.slice(start, end), eol: open[1] ?? '\n' };
}

/** The offset just past the line ending after `offset`. */
function lineEnd(s: string, offset: number): number {
  const nl = s.indexOf('\n', Math.max(0, offset - 1));
  return nl === -1 ? s.length : nl + 1;
}

/**
 * A value as YAML text on one line. Text fields that look like numbers (IDs, sprints, releases)
 * are written plain, as people write them (`parent: 1.10`); ob reads them as text anyway. Other
 * text is quoted only when YAML would misread it.
 */
export function formatValue(key: string, value: FieldValue): string {
  if (Array.isArray(value)) return `[${value.map(v => formatValue('', v)).join(', ')}]`;
  if (typeof value !== 'string') return String(value);
  if (/[\r\n]/.test(value)) throw new Error(`${key}: a front-matter value must be on one line`);
  if (TEXT_FIELDS.includes(key) && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)) return value;
  // YAML 1.1 readers (other tools) take these as booleans or null, so they are always quoted.
  if (/^(y|yes|n|no|on|off|true|false|null|~)$/i.test(value)) return JSON.stringify(value);
  return stringify(value, { lineWidth: 0 }).trimEnd();
}

/** Changes fields in an item's file on disk; returns true if the file changed. */
export function updateItem(backlogDir: string, item: Item, changes: Record<string, FieldValue | undefined>): boolean {
  const path = join(backlogDir, item.path);
  const before = readFileSync(path, 'utf8');
  let after: string;
  try {
    after = setFields(before, changes);
  } catch (e) {
    throw new BacklogError(`${item.path}: ${(e as Error).message}`, path);
  }
  if (after === before) return false;
  writeFileSync(path, after);
  return true;
}

/** What a new item needs; ID assignment comes from the caller (2.2.6). */
export interface NewItem {
  id: string;
  type: string;
  title: string;
  parent?: string;
  /** Made from the title when not given. */
  slug?: string;
  /** More fields, written after id, type, title and parent, in this order. */
  fields?: Record<string, FieldValue>;
  /** For story-level items: the recommended shape (spec section 3), with placeholders for what's missing. */
  asA?: string;
  wantTo?: string[];
  soThat?: string[];
}

/** A slug from a title: up to six lowercase words of letters and digits, joined by dashes (as the site's maker). */
export function slugify(title: string): string {
  return title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 6).join('-');
}

/** The folder a new item goes in: story-level items start in stories/todo/. */
export function folderFor(type: string): string {
  const folders: Record<string, ItemFolder> = { capability: 'capabilities', epic: 'epics', feature: 'features' };
  return folders[type] ?? 'stories/todo';
}

/** A new item's path in the backlog: `stories/todo/2.3.5-ob-list.md`. */
export function newItemPath(n: NewItem): string {
  const slug = n.slug?.trim() || slugify(n.title) || n.type;
  return `${folderFor(n.type)}/${n.id}-${slug}.md`;
}

/**
 * A new item file's text: front matter (id, type, title, parent, then any other fields) and, for
 * a story-level item, the recommended body: "As a … I want to:", "So that:" and "## Comments".
 * The same shape openbacklog.org's story maker writes.
 */
export function newItemText(n: NewItem): string {
  const fm = [`id: ${n.id}`, `type: ${n.type}`, `title: ${formatValue('title', n.title.trim())}`];
  if (n.parent) fm.push(`parent: ${formatValue('parent', n.parent)}`);
  for (const [k, v] of Object.entries(n.fields ?? {})) fm.push(`${k}: ${formatValue(k, v)}`);
  const lines = ['---', ...fm, '---'];
  if (STORY_LEVEL.includes(n.type)) {
    const want = n.wantTo?.length ? n.wantTo : ['<what they want>'];
    const why = n.soThat?.length ? n.soThat : ['<why, written so it can be checked>'];
    lines.push('', `**As a** ${n.asA?.trim() || '<who>'}, **I want to:**`, ...want.map(l => `- ${l}`),
      '', '**So that:**', ...why.map(l => `- ${l}`), '', '## Comments');
  }
  return lines.join('\n') + '\n';
}

/**
 * Writes a new item file into the backlog and returns its path from the backlog folder. Never
 * overwrites: an existing file is a BacklogError.
 */
export function createItem(backlogDir: string, n: NewItem): string {
  const path = newItemPath(n);
  const full = join(backlogDir, path);
  if (existsSync(full)) throw new BacklogError(`${path}: already exists`, full);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, newItemText(n), { flag: 'wx' });
  return path;
}
