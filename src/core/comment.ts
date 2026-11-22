import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { changes, commit, message } from './git.js';
import type { Backlog } from './types.js';
import { BacklogError } from './types.js';

/**
 * Comments (2.3.9): one line under the item's `## Comments`, `- YYYY-MM-DD @handle: text`
 * ([comment-line]), the same line you would add by hand, and one commit. Signed with a handle,
 * never an email address ([no-email]): the handle comes from --as or `git config ob.handle`,
 * never from git's user.email or user.name.
 */

/** A handle (spec, Fields): lowercase letters, digits, -, _ and ., such as jo-smith. */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const HEADING = /^## Comments[ \t]*$/;

export interface Comment {
  date: string;
  handle: string;
  /** The comment, with any continuation lines joined by "\n" (their indent removed). */
  text: string;
}

export interface CommentOptions {
  text: string;
  /** Who signs it; by default `git config ob.handle`. */
  handle?: string;
  /** The day it's dated (default today, local time). */
  day?: Date;
  /** Commit it (default true; nothing to commit outside git). */
  commit?: boolean;
}

export interface Commented {
  id: string;
  /** The item's file, from the backlog folder. */
  path: string;
  /** The line added (its first line, for a comment over several lines). */
  line: string;
  committed: boolean;
}

/** The handle git is set up with (`git config ob.handle`, local or global), or null. */
export function configuredHandle(dir: string): string | null {
  try {
    const h = execFileSync('git', ['config', '--get', 'ob.handle'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return h || null;
  } catch {
    return null;
  }
}

/** "2026-11-22" in local time. */
export function dayOf(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

/**
 * The file with the comment added: after the last line of `## Comments` (before any heading that
 * follows it), or, with no such section, a new one at the end. Every other byte is kept, and the
 * file's own line endings are used. A text over several lines continues on lines indented two
 * spaces.
 */
export function withComment(file: string, comment: Comment): string {
  const nl = file.includes('\r\n') ? '\r\n' : '\n';
  const lines = `- ${comment.date} @${comment.handle}: ${comment.text.split(/\r?\n/).join(`${nl}  `)}`;
  const head = file.split(/\r?\n/).findIndex(l => HEADING.test(l));
  if (head === -1) {
    // A new section at the end, after a blank line, as you would type it.
    let s = file;
    if (s && !s.endsWith(nl)) s += nl;
    if (s && !s.endsWith(nl + nl)) s += nl;
    return `${s}## Comments${nl}${lines}${nl}`;
  }
  const all = file.split(/\r?\n/);
  // The section runs to the next heading (# or ##) or the end; the comment goes after its last
  // line that isn't blank, so blank lines before a following heading stay where they are.
  let end = all.findIndex((l, i) => i > head && /^#{1,2} /.test(l));
  if (end === -1) end = all.length;
  let last = end - 1;
  while (last > head && (all[last] ?? '').trim() === '') last--;
  all.splice(last + 1, 0, lines);
  return all.join(nl);
}

/** The comments under an item's `## Comments`, oldest first; lines that aren't comments are skipped. */
export function commentsOf(file: string): Comment[] {
  const all = file.split(/\r?\n/);
  const head = all.findIndex(l => HEADING.test(l));
  if (head === -1) return [];
  const out: Comment[] = [];
  let current: Comment | null = null;
  for (const l of all.slice(head + 1)) {
    if (/^#{1,2} /.test(l)) break;
    const m = /^- (\d{4}-\d{2}-\d{2}) @([a-z0-9][a-z0-9._-]*): ?(.*)$/.exec(l);
    if (m) out.push(current = { date: m[1] ?? '', handle: m[2] ?? '', text: m[3] ?? '' });
    else if (current && /^\s+\S/.test(l)) current.text += `\n${l.trim()}`;
    // Anything else ends a comment; a list item that isn't one is ob validate's to report.
    else if (l.trim()) current = null;
  }
  return out;
}

/**
 * Adds a comment to an item, any type, in any folder, and commits that file alone:
 * "ob: comment on 2.3.4". Everything is checked first; a BacklogError writes nothing.
 */
export function addComment(b: Backlog, id: string, opts: CommentOptions): Commented {
  const found = b.items.filter(i => i.id === id);
  const item = found[0];
  if (!item) throw new BacklogError(`no item ${id} in this backlog`);
  if (found.length > 1) throw new BacklogError(`${found.length} items have id ${id} (${found.map(i => i.path).join(', ')}); run ob validate --fix first`);

  const text = opts.text.replace(/\s+$/, '').replace(/^\s+/, '');
  if (!text) throw new BacklogError('a comment needs some text');
  if (EMAIL.test(text)) throw new BacklogError('a comment can\'t hold an email address ([no-email]); name people by handle, such as @jo-smith');

  const handle = (opts.handle ?? configuredHandle(b.dir) ?? '').replace(/^@/, '');
  if (!handle) {
    throw new BacklogError('who is commenting? Set your handle once with: git config --global ob.handle <handle> (such as jo-smith), or pass --as <handle>. ob never uses your git email');
  }
  if (!HANDLE_PATTERN.test(handle)) throw new BacklogError(`"${handle}" is not a handle: use lowercase letters, digits, -, _ and ., such as jo-smith`);

  const abs = join(b.dir, item.path);
  const wantCommit = opts.commit !== false;
  if (wantCommit && changes(b.dir, [abs]).length) {
    throw new BacklogError(`${item.path} has changes that aren't committed; commit them first, or add the comment with --no-commit`);
  }

  const before = readFileSync(abs, 'utf8');
  const comment = { date: dayOf(opts.day ?? new Date()), handle, text };
  writeFileSync(abs, withComment(before, comment));
  const committed = wantCommit ? commit([abs], message.comment(id)) : false;
  return { id, path: item.path, line: `- ${comment.date} @${handle}: ${text.split(/\r?\n/)[0]}`, committed };
}
