import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, renameSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { parseFileName } from './ids.js';
import type { Backlog, Item, Status } from './types.js';
import { BacklogError } from './types.js';

/**
 * Git (2.2.6, D2): ob runs the user's own `git`, with their environment, so their identity, SSH
 * key or credential helper, hooks and settings all apply and ob needs no token. Outside a git
 * repository everything still works except committing, pulling and pushing.
 */

/** Runs git in `cwd`; a failure is a BacklogError with git's own first line of complaint. */
export function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const err = e as { code?: string; stderr?: string };
    if (err.code === 'ENOENT') throw new BacklogError('git is not installed, or not on your PATH');
    const said = (err.stderr ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? String(e);
    throw new BacklogError(`git ${args[0] ?? ''}: ${said.replace(/^(fatal|error): /, '')}`);
  }
}

/** The top folder of the git repository holding `dir`, or null if it isn't in one (or git is missing). */
export function repoRoot(dir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Commit messages ob writes (D3): one line, starting "ob:". */
export const message = {
  move: (id: string, status: Status) => `ob: move ${id} to ${status}`,
  add: (id: string, title: string) => `ob: add ${id} ${title}`,
  edit: (id: string, what: string) => `ob: edit ${id} ${what}`,
};

/**
 * Paths for git: relative to the repository's top, with "/". git gives that top as a real path,
 * so each path is resolved through symlinks first (on macOS, /var is /private/var), including
 * paths that don't exist yet, such as where a file is moving to.
 */
function forGit(root: string, paths: string[]): string[] {
  return paths.map(p => relative(root, realPath(p)).split(sep).join('/') || '.');
}

/** A path with its deepest existing folder resolved through symlinks. */
function realPath(p: string): string {
  const rest: string[] = [];
  let dir = resolve(p);
  while (!existsSync(dir) && dirname(dir) !== dir) {
    rest.unshift(basename(dir));
    dir = dirname(dir);
  }
  return join(realpathSync(dir), ...rest);
}

/** True if git tracks the file. */
function tracked(root: string, file: string): boolean {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', ...forGit(root, [file])], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Moves a file (absolute paths), making the destination folder. A tracked file moves with
 * `git mv`, so git keeps its history; anything else, or anything outside git, is a plain rename.
 */
export function move(from: string, to: string): void {
  if (existsSync(to)) throw new BacklogError(`${to}: already exists`, to);
  mkdirSync(dirname(to), { recursive: true });
  const root = repoRoot(dirname(from));
  if (root && tracked(root, from)) git(root, ['mv', '--', ...forGit(root, [from, to])]);
  else renameSync(from, to);
}

/**
 * Commits exactly these files (absolute paths; for a move, both the old and the new path) with
 * the user's own identity, and nothing else that happens to be staged or changed. Returns false
 * outside git, where there is nothing to commit to.
 */
export function commit(paths: string[], msg: string): boolean {
  const start = paths.map(p => dirname(p)).find(d => existsSync(d));
  const root = start ? repoRoot(start) : null;
  if (!root) return false;
  // Stage what is there, or what git still tracks (a deletion); a path git mv already moved away
  // is neither, but the commit below still records its side of the rename.
  const toAdd = paths.filter(p => existsSync(p) || tracked(root, p));
  if (toAdd.length) git(root, ['add', '-A', '--', ...forGit(root, toAdd)]);
  git(root, ['commit', '--quiet', '-m', msg, '--', ...forGit(root, paths)]);
  return true;
}

/** Uncommitted changes under these paths (or the whole repository): `git status --porcelain` lines. */
export function changes(dir: string, paths: string[] = []): string[] {
  const root = repoRoot(dir);
  if (!root) return [];
  return git(root, ['status', '--porcelain', '--untracked-files=all', '--', ...forGit(root, paths.length ? paths : [root])])
    .split('\n').filter(Boolean);
}

/** True when nothing under these paths (or the repository) has uncommitted changes; always true outside git. */
export function isClean(dir: string, paths: string[] = []): boolean {
  return changes(dir, paths).length === 0;
}

export interface LogEntry {
  hash: string;
  date: string;
  author: string;
  subject: string;
}

/** A file's history, newest first, following it through moves. Empty outside git. */
export function history(file: string): LogEntry[] {
  const root = repoRoot(dirname(file));
  if (!root) return [];
  return git(root, ['log', '--follow', '--date=short', '--format=%h%x09%ad%x09%an%x09%s', '--', ...forGit(root, [file])])
    .split('\n').filter(Boolean).map(l => {
      const [hash = '', date = '', author = '', ...subject] = l.split('\t');
      return { hash, date, author, subject: subject.join('\t') };
    });
}

/** `git pull`, then `git push`, as the user's git is set up to do them (D3's Sync). */
export function pull(dir: string): string {
  return git(requireRepo(dir), ['pull']);
}

export function push(dir: string): string {
  return git(requireRepo(dir), ['push']);
}

function requireRepo(dir: string): string {
  const root = repoRoot(dir);
  if (!root) throw new BacklogError(`${dir} is not in a git repository, so there is nothing to pull or push`);
  return root;
}

/**
 * Every ID the backlog has ever used: the items there now (front matter and file names) and every
 * item file deleted, or moved away, in git history ([id-numbers]).
 */
export function usedIds(b: Backlog): Set<string> {
  const ids = new Set<string>();
  for (const i of b.items) {
    ids.add(i.id);
    if (i.file) ids.add(i.file.id);
  }
  const root = repoRoot(b.dir);
  if (root) {
    // --no-renames shows a move as a delete and an add, so the old name counts too.
    const deleted = git(root, ['log', '--no-renames', '--diff-filter=D', '--name-only', '--format=', '--', ...forGit(root, [b.dir])]);
    for (const path of deleted.split('\n').filter(Boolean)) {
      const parsed = parseFileName(path.slice(path.lastIndexOf('/') + 1));
      if (parsed) ids.add(parsed.id);
    }
  }
  return ids;
}

/**
 * The next ID ([id-numbers]): one more than the highest ever used under `parent` (a feature for
 * story-level items, an epic for features), counting pruned items in git history, so a number is
 * never used twice. With no parent: the next epic (epic 0 is kept for unplanned work, so the
 * first is 1), or with `capability`, the next C number.
 */
export function nextId(b: Backlog, parent?: string, capability = false): string {
  const used = [...usedIds(b)];
  if (capability) {
    const n = Math.max(0, ...used.filter(id => /^C\d+$/.test(id)).map(id => Number(id.slice(1))));
    return `C${n + 1}`;
  }
  const prefix = parent === undefined ? '' : `${parent}.`;
  const depth = parent === undefined ? 1 : parent.split('.').length + 1;
  const numbers = used
    .filter(id => /^\d+(\.\d+)*$/.test(id) && id.startsWith(prefix) && id.split('.').length === depth)
    .map(id => Number(id.split('.').pop()));
  return `${prefix}${Math.max(0, ...numbers) + 1}`;
}

/**
 * Where a story-level item goes for a status: stories/todo/ or doing/, and stories/done/ or,
 * with `done-folders: month` in config.yml, stories/done/YYYY-MM/ for the given day.
 */
export function statusPath(b: Backlog, item: Item, status: Status, day: Date = new Date()): string {
  const name = item.path.slice(item.path.lastIndexOf('/') + 1);
  if (status !== 'done') return `stories/${status}/${name}`;
  if (b.config['done-folders'] !== 'month') return `stories/done/${name}`;
  const month = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`;
  return `stories/done/${month}/${name}`;
}

/**
 * Moves a story-level item to a status, and commits the move alone ("ob: move 2.3.4 to doing")
 * unless `commit` is false or the backlog isn't in git. Returns the new path and whether it
 * committed.
 */
export function moveItem(b: Backlog, item: Item, status: Status, opts: { commit?: boolean; day?: Date } = {}): { path: string; committed: boolean } {
  if (item.status === status) return { path: item.path, committed: false };
  const to = statusPath(b, item, status, opts.day);
  const fromAbs = join(b.dir, item.path), toAbs = join(b.dir, to);
  move(fromAbs, toAbs);
  const committed = opts.commit === false ? false : commit([fromAbs, toAbs], message.move(item.id, status));
  return { path: to, committed };
}

