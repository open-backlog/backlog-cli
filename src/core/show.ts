import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { git, history, repoRoot } from './git.js';
import type { LogEntry } from './git.js';
import { buildTree, isStoryLevel, progressOf } from './hierarchy.js';
import type { Progress } from './hierarchy.js';
import { parseFileName } from './ids.js';
import { statusOf } from './read.js';
import type { Backlog, Item, Status } from './types.js';
import { BacklogError } from './types.js';
import { parseMapping, splitFrontMatter } from './yaml.js';

/**
 * One item in full (2.3.6): where it sits in the plan, its file, its children, progress and
 * history. An ID no longer in the backlog is looked up in git history, so an old reference to a
 * pruned item still leads somewhere ([id-numbers]: its number stays used).
 */

export interface Shown {
  id: string;
  type: string;
  title: string;
  /** From the backlog folder; for a deleted item, where it was. */
  path: string;
  /** The file names, without .md, from the top of the plan down to this item: 2-build › 2.3-cli › 2.3.4-ob-move. */
  breadcrumb: string[];
  status: Status | null;
  fields: Record<string, unknown>;
  /** The whole file, front matter and body. */
  text: string;
  /** Capabilities, epics and features: worked out from their story-level items (2.2.4). */
  progress: Progress | null;
  children: { id: string; type: string; title: string; status: Status | null; path: string }[];
  /** Commits that touched the file, newest first; empty outside git. */
  history: LogEntry[];
  /** For an item pruned with git rm: the commit that removed it. Its text is the last version. */
  deleted: LogEntry | null;
  /** Other items with the same ID ([id-unique]), if any. */
  sameId: string[];
}

const stem = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');

/** An item, or a pruned one from git history; a BacklogError if the ID was never used. */
export function showItem(b: Backlog, id: string): Shown {
  const tree = buildTree(b.items);
  const node = tree.byId.get(id);
  const sameId = b.items.filter(i => i.id === id).slice(1).map(i => i.path);
  const childrenOf = (pid: string) => b.items.filter(i => i.parent === pid && i.id !== pid)
    .map(i => ({ id: i.id, type: i.type, title: i.title, status: i.status ?? null, path: i.path }));
  /** Ancestors' file names (the item's own last), stopping at a loop or a missing parent. */
  const crumbs = (first: Item | undefined, own: string): string[] => {
    const out = [own];
    const seen = new Set<string>();
    for (let p = first?.parent; p !== undefined && !seen.has(p); ) {
      seen.add(p);
      const up = tree.byId.get(p);
      out.unshift(up ? stem(up.item.path) : p);
      p = up?.item.parent;
    }
    return out;
  };

  if (node) {
    const item = node.item;
    return {
      id, type: item.type, title: item.title, path: item.path, breadcrumb: crumbs(item, stem(item.path)),
      status: item.status ?? null, fields: item.fields, text: readFileSync(join(b.dir, item.path), 'utf8'),
      progress: isStoryLevel(item) ? null : progressOf(node), children: childrenOf(id),
      history: history(join(b.dir, item.path)), deleted: null, sameId,
    };
  }

  const pruned = findPruned(b, id);
  if (!pruned) throw new BacklogError(`no item ${id} in this backlog, now or in its git history`);
  const fields = frontMatter(pruned.text);
  const parent = typeof fields['parent'] === 'string' || typeof fields['parent'] === 'number' ? String(fields['parent']) : undefined;
  const type = String(fields['type'] ?? '');
  const ghost = { parent } as Item;
  return {
    id, type, title: String(fields['title'] ?? ''), path: pruned.path, breadcrumb: crumbs(ghost, stem(pruned.path)),
    status: statusOf(pruned.path) ?? null, fields, text: pruned.text, progress: null, children: childrenOf(id),
    history: pruned.history, deleted: pruned.deleted, sameId: [],
  };
}

/** The newest commit that removed an item file with this ID (and didn't add it back elsewhere: a move). */
function findPruned(b: Backlog, id: string): { path: string; text: string; deleted: LogEntry; history: LogEntry[] } | null {
  const root = repoRoot(b.dir);
  if (!root) return null;
  let out: string;
  try {
    out = git(b.dir, ['log', '--no-renames', '--diff-filter=AD', '--name-status', '--relative', '--date=short',
      '--format=%x00%h%x09%ad%x09%an%x09%s', '--', '.']);
  } catch {
    return null; // no commits yet
  }
  for (const block of out.split('\0').filter(Boolean)) {
    const [head = '', ...lines] = block.split('\n').filter(Boolean);
    const [hash = '', date = '', author = '', ...subject] = head.split('\t');
    const changes = lines.map(l => l.split('\t')).map(([st = '', path = '']) => ({ st, path }));
    const added = new Set(changes.filter(c => c.st === 'A').map(c => stem(c.path)));
    const gone = changes.find(c => c.st === 'D' && parseFileName(stem(c.path) + '.md')?.id === id && !added.has(stem(c.path)));
    if (gone) {
      const text = git(b.dir, ['show', `${hash}^:./${gone.path}`]);
      const deleted = { hash, date, author, subject: subject.join('\t') };
      return { path: gone.path, text, deleted, history: history(join(b.dir, gone.path)) };
    }
  }
  return null;
}

/** A pruned file's front matter, read as the reader reads files; {} if it can't be. */
function frontMatter(text: string): Record<string, unknown> {
  try {
    const fm = splitFrontMatter(text);
    return (fm && parseMapping(fm.front)) ?? {};
  } catch {
    return {};
  }
}
