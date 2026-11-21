import { git, repoRoot } from './git.js';
import { buildOrder, isStoryLevel, STORY_LEVEL_TYPES } from './hierarchy.js';
import type { Backlog, Item, Status } from './types.js';
import { BacklogError } from './types.js';

/**
 * Listing (2.3.5): story-level items in build order, filtered, with old done work left out so a
 * big done/ never floods the list. The board's filters use the same function.
 */

export interface ListFilters {
  /** Each filter matches any of its values; filters combine (all must match). */
  status?: string[];
  type?: string[];
  /** An epic, feature or capability: items anywhere under it. */
  parent?: string[];
  repo?: string[];
  assignee?: string[];
  sprint?: string[];
}

export interface ListOptions {
  /** Include done items however long ago they were finished (default: the last `days`). */
  all?: boolean;
  /** How far back done work is shown, in days (default 30). */
  days?: number;
  /** Now, for the window (tests). */
  now?: Date;
}

export interface Listed {
  items: Item[];
  /** Done items left out because they were finished before the window. */
  hiddenDone: number;
}

/** An item's repo field as a list (a name or a list of names). */
export function reposOf(item: Item): string[] {
  const r = item.fields['repo'];
  return (Array.isArray(r) ? r : r === undefined || r === null ? [] : [r]).map(String);
}

const STATUSES: readonly Status[] = ['todo', 'doing', 'done'];

/**
 * Done items finished in the window: those whose file a commit since then moved into (or added
 * to, or changed in) stories/done/, plus any not yet committed. Every commit touching done/ is
 * read and its date checked here: git log --since stops at the first older commit, so one
 * out-of-order date (a rebase) would hide recent work. Null outside git, where there are no
 * dates, so every done item counts as recent.
 */
export function recentlyDone(b: Backlog, since: Date): Set<string> | null {
  if (!repoRoot(b.dir)) return null;
  const recent = new Set<string>();
  const cutoff = since.getTime() / 1000;
  let committed = new Set<string>();
  try {
    let time = 0;
    for (const line of git(b.dir, ['log', '-M', '--name-only', '--relative', '--format=%x00%ct', '--', 'stories/done']).split('\n')) {
      if (line.startsWith('\0')) time = Number(line.slice(1));
      else if (line && time >= cutoff) recent.add(line);
    }
    committed = new Set(git(b.dir, ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'stories/done']).split('\n').filter(Boolean));
  } catch {
    // No commits yet: nothing is committed, so every done item is new.
  }
  for (const i of b.items) if (i.status === 'done' && !committed.has(i.path)) recent.add(i.path);
  return recent;
}

/** Story-level items in build order (by number), filtered; done ones from the last 30 days unless `all`. */
export function listItems(b: Backlog, filters: ListFilters = {}, opts: ListOptions = {}): Listed {
  for (const s of filters.status ?? []) if (!STATUSES.includes(s as Status)) throw new BacklogError(`"${s}" is not a status: use todo, doing or done`);
  for (const t of filters.type ?? []) if (!STORY_LEVEL_TYPES.includes(t)) throw new BacklogError(`"${t}" is not a type ob list shows: use story, bug, spike or task`);
  const byId = new Map(b.items.map(i => [i.id, i]));
  for (const p of filters.parent ?? []) if (!byId.has(p)) throw new BacklogError(`no item ${p} in this backlog`);

  /** True if `ancestor` is the item's parent, its parent's parent, and so on. */
  const under = (item: Item, ancestor: string): boolean => {
    const seen = new Set<string>();
    for (let p = item.parent; p !== undefined && !seen.has(p); p = byId.get(p)?.parent) {
      if (p === ancestor) return true;
      seen.add(p);
    }
    return false;
  };
  const any = (want: string[] | undefined, have: string[]) => !want?.length || want.some(w => have.includes(w));
  const text = (v: unknown) => (v === undefined || v === null ? [] : [String(v).replace(/^@/, '')]);

  const matched = buildOrder(b.items.filter(isStoryLevel)).filter(i =>
    any(filters.status, i.status ? [i.status] : [])
    && any(filters.type, [i.type])
    && (!filters.parent?.length || filters.parent.some(p => under(i, p)))
    && any(filters.repo, reposOf(i))
    && any(filters.assignee?.map(a => a.replace(/^@/, '')), text(i.fields['assignee']))
    && any(filters.sprint, text(i.fields['sprint'])));

  if (opts.all) return { items: matched, hiddenDone: 0 };
  const now = opts.now ?? new Date();
  const recent = recentlyDone(b, new Date(now.getTime() - (opts.days ?? 30) * 86_400_000));
  if (!recent) return { items: matched, hiddenDone: 0 };
  const items = matched.filter(i => i.status !== 'done' || recent.has(i.path));
  return { items, hiddenDone: matched.length - items.length };
}
