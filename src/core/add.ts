import { join } from 'node:path';

import { commit, message, monthOf, nextId } from './git.js';
import { STORY_LEVEL_TYPES } from './hierarchy.js';
import type { Backlog, ItemType } from './types.js';
import { BacklogError } from './types.js';
import { createItem, slugify } from './write.js';
import type { NewItem } from './write.js';

/**
 * Adding an item (2.3.2): the next free ID under its parent ([id-numbers]), a file from the
 * template, and one commit. Everything is checked before anything is written.
 */

export const ITEM_TYPES: readonly ItemType[] = ['capability', 'epic', 'feature', 'story', 'bug', 'spike', 'task'];

/** Types that may be filed with no parent into this month's feature in epic 0. */
export const UNPLANNED_TYPES: readonly ItemType[] = ['bug', 'task'];

/** A slug a user chooses: lowercase letters and digits joined by dashes. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface AddOptions {
  type: string;
  title: string;
  parent?: string;
  slug?: string;
  /** Commit the new files (default true; nothing to commit outside git). */
  commit?: boolean;
  /** The day, for this month's feature in epic 0. */
  day?: Date;
}

export interface Added {
  id: string;
  /** The new item's file, from the backlog folder. */
  path: string;
  /** Every file written, from the backlog folder: epic 0 and the month's feature when they were needed, then the item. */
  created: { id: string; path: string }[];
  committed: boolean;
}

/** The type a parent must have, or null for none; capability is optional for an epic. */
function parentType(type: string): string | null {
  if (type === 'feature') return 'epic';
  if (type === 'epic') return 'capability';
  if (STORY_LEVEL_TYPES.includes(type)) return 'feature';
  return null;
}

/**
 * Adds an item to the backlog. A bug or task with no parent goes into this month's feature in
 * epic 0 (0.1-2026-11), and the epic and feature are created first if they aren't there.
 * Throws a BacklogError, having written nothing, if the type, title, slug or parent is wrong.
 */
export function addItem(b: Backlog, opts: AddOptions): Added {
  const { type } = opts;
  const title = opts.title.trim();
  if (!ITEM_TYPES.includes(type as ItemType)) throw new BacklogError(`"${type}" is not a type: use ${ITEM_TYPES.join(', ')}`);
  if (!title) throw new BacklogError('a new item needs a title');
  if (/[\r\n]/.test(title)) throw new BacklogError('a title is one line');
  if (opts.slug !== undefined && !SLUG_PATTERN.test(opts.slug)) {
    throw new BacklogError(`"${opts.slug}" can't be a slug: use lowercase letters, digits and dashes, such as sign-in-form`);
  }
  if (!slugify(title) && opts.slug === undefined) throw new BacklogError(`can't make a slug from "${title}"; choose one with --slug`);

  const byId = (id: string) => b.items.find(i => i.id === id);
  const want = parentType(type);
  const pending: NewItem[] = [];
  let parent = opts.parent?.trim() || undefined;

  if (parent !== undefined) {
    if (want === null) throw new BacklogError(`${article(type)} ${type} has no parent`);
    if (parent.includes('/')) throw new BacklogError(`parent ${parent} is in another backlog; ob new files items under a parent in this one`);
    const p = byId(parent);
    if (!p) throw new BacklogError(`parent ${parent} is not in this backlog`);
    if (p.type !== want) throw new BacklogError(`parent ${parent} is ${article(p.type)} ${p.type}; ${article(type)} ${type}'s parent must be ${article(want)} ${want}`);
    if (type === 'feature' && parent === '0') throw new BacklogError('epic 0 has one feature per month, made by ob new bug or ob new task with no --parent');
  } else if (want === 'feature') {
    if (!UNPLANNED_TYPES.includes(type as ItemType)) {
      throw new BacklogError(`${article(type)} ${type} needs --parent <feature>, such as --parent 2.3; only a bug or task with no parent goes into unplanned work (epic 0)`);
    }
    const month = monthOf(opts.day ?? new Date());
    const epic0 = byId('0');
    if (epic0 && epic0.type !== 'epic') throw new BacklogError(`item 0 is ${article(epic0.type)} ${epic0.type}, so there is no epic 0 for unplanned work`);
    const feature = b.items.find(i => i.type === 'feature' && i.parent === '0' && i.file?.slug === month);
    if (feature) parent = feature.id;
    else {
      if (!epic0) pending.push({ id: '0', type: 'epic', title: 'Unplanned work', slug: 'unplanned' });
      parent = nextId(b, '0');
      pending.push({ id: parent, type: 'feature', title: `Unplanned, ${month}`, parent: '0', slug: month });
    }
  } else if (want === 'epic') {
    throw new BacklogError('a feature needs --parent <epic>, such as --parent 2');
  }

  const id = type === 'capability' ? nextId(b, undefined, true) : type === 'epic' ? nextId(b) : nextId(b, parent);
  pending.push({ id, type, title, ...(parent ? { parent } : {}), ...(opts.slug ? { slug: opts.slug } : {}) });

  const created = pending.map(n => ({ id: n.id, path: createItem(b.dir, n) }));
  const path = created[created.length - 1]?.path ?? '';
  let committed = false;
  if (opts.commit !== false) {
    try {
      committed = commit(created.map(c => join(b.dir, c.path)), message.add(id, title));
    } catch (e) {
      throw new BacklogError(`created ${created.map(c => c.path).join(', ')}, but did not commit: ${(e as Error).message}`);
    }
  }
  return { id, path, created, committed };
}

function article(word: string): string {
  return /^[aeiou]/.test(word) ? 'an' : 'a';
}
