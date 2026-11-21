import { compareIds } from './ids.js';
import type { Item, Status } from './types.js';

/**
 * The hierarchy and progress (2.2.4). Children are never written down (spec section 2): an
 * item's children are the items whose `parent` is its `id`. Progress is worked out from the
 * story-level items, never stored ([not-stored]).
 */

export const STORY_LEVEL_TYPES = ['story', 'bug', 'spike', 'task'];

export const isStoryLevel = (item: Item): boolean => STORY_LEVEL_TYPES.includes(item.type);

export interface Progress {
  /** Story-level items under it, by status. One outside a status folder counts in `total` only. */
  done: number;
  doing: number;
  todo: number;
  total: number;
  /** done / total, rounded; 0 when there are none. */
  percent: number;
  /** The same, weighted by `estimate` (items without a number count 0). */
  estimate: { done: number; total: number };
  /**
   * As the spec says: a feature is done when all its story-level items are done and in progress
   * when any is in doing or done; an epic is done when all its features are, a capability when
   * all its epics are. Nothing under it: todo.
   */
  status: Status;
}

export interface Node {
  item: Item;
  /** The node its `parent` names, if that item is in the backlog. */
  parent: Node | null;
  /** Ordered by ID. */
  children: Node[];
}

export interface Tree {
  /** Items with no parent, or whose parent isn't in the backlog; ordered by ID. */
  roots: Node[];
  /** Items whose `parent` names no item in the backlog (validation reports [parent-exists]). */
  orphans: Node[];
  /** Each ID's node (the first, if an ID is used twice; validation reports [id-unique]). */
  byId: Map<string, Node>;
}

/** Links every item to its parent and gives every item its children. */
export function buildTree(items: Item[]): Tree {
  const byId = new Map<string, Node>();
  const nodes = [...items].sort((a, b) => compareIds(a.id, b.id)).map(item => ({ item, parent: null, children: [] } as Node));
  for (const n of nodes) if (!byId.has(n.item.id)) byId.set(n.item.id, n);
  const roots: Node[] = [], orphans: Node[] = [];
  for (const n of nodes) {
    const pid = n.item.parent;
    const parent = pid === undefined ? undefined : byId.get(pid);
    if (parent && parent !== n) {
      n.parent = parent;
      parent.children.push(n);
    } else {
      roots.push(n);
      if (pid !== undefined) orphans.push(n);
    }
  }
  return { roots, orphans, byId };
}

/** Progress of any node; for a story-level item, its own status as one item. */
export function progressOf(node: Node): Progress {
  if (isStoryLevel(node.item)) {
    const s = node.item.status;
    const est = estimateOf(node.item);
    return finish({ done: s === 'done' ? 1 : 0, doing: s === 'doing' ? 1 : 0, todo: s === 'todo' ? 1 : 0, total: 1,
      estimate: { done: s === 'done' ? est : 0, total: est } }, s ?? 'todo');
  }
  const parts = node.children.map(progressOf);
  const sum = (f: (p: Progress) => number) => parts.reduce((a, p) => a + f(p), 0);
  const counts = {
    done: sum(p => p.done), doing: sum(p => p.doing), todo: sum(p => p.todo), total: sum(p => p.total),
    estimate: { done: sum(p => p.estimate.done), total: sum(p => p.estimate.total) },
  };
  const status: Status = parts.length > 0 && parts.every(p => p.status === 'done') ? 'done'
    : parts.some(p => p.status !== 'todo') ? 'doing' : 'todo';
  return finish(counts, status);
}

function finish(c: Omit<Progress, 'percent' | 'status'>, status: Status): Progress {
  return { ...c, percent: c.total ? Math.round((c.done / c.total) * 100) : 0, status };
}

function estimateOf(item: Item): number {
  const e = item.fields['estimate'];
  return typeof e === 'number' && Number.isFinite(e) && e >= 0 ? e : 0;
}

/**
 * Build order: every item by its ID, part by part as numbers (2.3.9 before 2.3.10), each parent
 * before what is filed under it, capabilities first. It reads top to bottom like a plan.
 */
export function buildOrder(items: Item[]): Item[] {
  return [...items].sort((a, b) => compareIds(a.id, b.id));
}

/**
 * The order within one status folder (a board column): items with a `rank` first, lowest first,
 * then the rest by ID (spec section 4).
 */
export function columnOrder(items: Item[]): Item[] {
  const rank = (i: Item) => (typeof i.fields['rank'] === 'number' ? (i.fields['rank'] as number) : Infinity);
  return [...items].sort((a, b) => rank(a) - rank(b) || compareIds(a.id, b.id));
}

/** The tree depth first, each node with its depth: for printing an indented outline. */
export function walk(tree: Tree): { node: Node; depth: number }[] {
  const out: { node: Node; depth: number }[] = [];
  const visit = (n: Node, depth: number) => { out.push({ node: n, depth }); n.children.forEach(c => visit(c, depth + 1)); };
  tree.roots.forEach(r => visit(r, 0));
  return out;
}
