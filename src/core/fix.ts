import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { addedIn, commit, isAncestor, message, move, nextId, repoRoot } from './git.js';
import { compareIds } from './ids.js';
import { loadBacklog } from './read.js';
import type { Backlog, Item } from './types.js';
import { BacklogError } from './types.js';
import { setFields, updateItem } from './write.js';

/**
 * `ob validate --fix` (2.3.3): repairs [id-unique], the problem a merge makes when two branches
 * each added the next number. Of items sharing an ID, the one added first in git history keeps
 * it; each one added later gets the next free number under its parent and a file renamed to
 * match (a git mv, so it keeps its history). Children that came with it, added on the same line
 * of history after it, get the new number as their parent. Nothing else changes.
 */

export interface Renumbered {
  from: string;
  to: string;
  /** The file before and after, from the backlog folder. */
  path: string;
  newPath: string;
  /** Children whose parent changed from `from` to `to`. */
  children: { id: string; path: string }[];
}

type Added = { hash: string; time: number } | null;

/** Orders two copies of an ID by when git added them: older first; uncommitted is newest. */
function older(dir: string, a: { item: Item; added: Added }, b: { item: Item; added: Added }): number {
  if (a.added && b.added && a.added.hash !== b.added.hash) {
    if (isAncestor(dir, a.added.hash, b.added.hash)) return -1;
    if (isAncestor(dir, b.added.hash, a.added.hash)) return 1;
    if (a.added.time !== b.added.time) return a.added.time - b.added.time;
  } else if (a.added && !b.added) return -1;
  else if (!a.added && b.added) return 1;
  return a.item.path < b.item.path ? -1 : 1;
}

/** The next free ID for an item of its type, under its parent. */
function nextFor(b: Backlog, item: Item): string {
  if (item.type === 'capability') return nextId(b, undefined, true);
  if (item.type === 'epic') return nextId(b);
  return nextId(b, item.parent ?? item.id.split('.').slice(0, -1).join('.'));
}

/** The first set of items sharing an ID, in ID order, so a parent is fixed before its children. */
function firstDuplicate(b: Backlog): Item[] | null {
  const ids = [...new Set(b.items.map(i => i.id))].sort(compareIds);
  for (const id of ids) {
    const same = b.items.filter(i => i.id === id);
    if (same.length > 1) return same;
  }
  return null;
}

/**
 * Renumbers duplicate IDs in the backlog in `dir` and commits every change in one commit
 * ("ob: renumber 2.3.5 to 2.3.6"), unless `commit` is false. Needs git, to tell which copy is
 * newer. Returns what it changed (empty if there were no duplicates).
 */
export function fixDuplicates(dir: string, opts: { commit?: boolean } = {}): { renumbered: Renumbered[]; committed: boolean } {
  let b = loadBacklog(dir);
  if (firstDuplicate(b) && !repoRoot(b.dir)) {
    throw new BacklogError('--fix needs git history to tell which of two items with the same id is newer; this backlog is not in a git repository');
  }
  const renumbered: Renumbered[] = [];
  const touched: string[] = [];
  for (let guard = b.items.length; guard > 0; guard--) {
    const same = firstDuplicate(b);
    if (!same) break;
    const copies = same.map(item => ({ item, added: addedIn(join(b.dir, item.path)) })).sort((x, y) => older(b.dir, x, y));
    const [keep, ...newer] = copies;
    if (!keep) break;
    const item = newer[0]?.item;
    const cB = newer[0]?.added ?? null;
    if (!item) break;
    const to = nextFor(b, item);
    const name = item.path.slice(item.path.lastIndexOf('/') + 1);
    // The file name's ID is replaced (or, if it has none, put in front); its slug stays.
    const rest = item.file ? name.slice(item.file.id.length) : `-${name}`;
    const newPath = `${item.path.slice(0, item.path.length - name.length)}${to}${rest}`;
    // The children that came with it: added after it on its line of history, not the kept one's.
    const children = b.items.filter(c => c.parent === item.id && c !== keep.item && c !== item).filter(c => {
      const cc = addedIn(join(b.dir, c.path));
      return cB !== null && cc !== null && isAncestor(b.dir, cB.hash, cc.hash) && !(keep.added && isAncestor(b.dir, keep.added.hash, cc.hash));
    });
    const from = join(b.dir, item.path), dest = join(b.dir, newPath);
    writeFileSync(from, setFields(readFileSync(from, 'utf8'), { id: to }));
    move(from, dest);
    for (const c of children) updateItem(b.dir, c, { parent: to });
    touched.push(from, dest, ...children.map(c => join(b.dir, c.path)));
    renumbered.push({ from: item.id, to, path: item.path, newPath, children: children.map(c => ({ id: c.id, path: c.path })) });
    b = loadBacklog(dir);
  }
  const committed = renumbered.length > 0 && opts.commit !== false ? commit(touched, message.renumber(renumbered)) : false;
  return { renumbered, committed };
}
