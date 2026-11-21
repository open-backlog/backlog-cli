import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { BacklogError, changes, commit, createItem, history, isClean, loadBacklog, message, move, moveItem, nextId, pull, push, repoRoot, statusPath, usedIds } from '../src/core/index.js';
import type { Backlog, Item } from '../src/core/index.js';

/** The item with an ID, failing the test if there is none. */
function find(b: Backlog, id: string): Item {
  const i = b.items.find(x => x.id === id);
  if (!i) throw new Error(`no item ${id}`);
  return i;
}

const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));
const tmps: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'ob-git-')); tmps.push(d); return d; };
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }); });

const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A repository holding a copy of a fixture backlog, committed, with its own identity (CI has none). */
function repo(fixture = 't1-minimal', name = 'Ana Silva'): { root: string; backlog: () => Backlog } {
  const root = tmp();
  cpSync(join(fixtures, fixture, 'backlog'), join(root, 'backlog'), { recursive: true });
  run(root, 'init', '-q', '-b', 'main');
  run(root, 'config', 'user.name', name);
  run(root, 'config', 'user.email', 'ana@example.com');
  run(root, 'add', '-A');
  run(root, 'commit', '-qm', 'start');
  return { root, backlog: () => loadBacklog(join(root, 'backlog')) };
}

/** The same fixture outside git. */
function plain(fixture = 't1-minimal'): Backlog {
  const root = tmp();
  cpSync(join(fixtures, fixture, 'backlog'), join(root, 'backlog'), { recursive: true });
  return loadBacklog(join(root, 'backlog'));
}

describe('the user\'s own git', () => {
  it('finds the repository, or knows there is none', () => {
    const { root } = repo();
    expect(repoRoot(join(root, 'backlog', 'stories'))).toBe(execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
    expect(repoRoot(plain().dir)).toBeNull();
  });

  it('moves a story with git mv and commits only that move, as the user, with a clear message', () => {
    const { root, backlog } = repo();
    writeFileSync(join(root, 'notes.txt'), 'unrelated work in progress\n');
    writeFileSync(join(root, 'backlog/config.yml'), 'spec: 0.1\nname: notes\n# edited\n');
    const b = backlog();
    const story = b.items.find(i => i.id === '1.1.3');
    if (!story) throw new Error('fixture changed');
    expect(moveItem(b, story, 'doing')).toEqual({ path: 'stories/doing/1.1.3-delete-note.md', committed: true });
    expect(run(root, 'log', '-1', '--format=%an|%s')).toBe('Ana Silva|ob: move 1.1.3 to doing');
    expect(run(root, 'show', '--name-status', '--format=', 'HEAD').split('\n')).toEqual(
      ['R100\tbacklog/stories/todo/1.1.3-delete-note.md\tbacklog/stories/doing/1.1.3-delete-note.md']);
    // The user's other changes are left exactly as they were.
    expect(changes(root).sort()).toEqual([' M backlog/config.yml', '?? notes.txt']);
    expect(isClean(root, [join(root, 'backlog/stories')])).toBe(true);
    expect(isClean(root)).toBe(false);
  });

  it('commits with the environment the user\'s git sees (identity, and so their SSH agent and credential helper)', () => {
    const { root, backlog } = repo();
    process.env['GIT_AUTHOR_NAME'] = 'From The Environment';
    try {
      const b = backlog();
      const story = b.items.find(i => i.id === '1.1.2');
      if (!story) throw new Error('fixture changed');
      moveItem(b, story, 'done');
      expect(run(root, 'log', '-1', '--format=%an')).toBe('From The Environment');
    } finally {
      delete process.env['GIT_AUTHOR_NAME'];
    }
  });

  it('follows a story through its moves in git log', () => {
    const { root, backlog } = repo();
    let b = backlog();
    const id = '1.1.3';
    moveItem(b, find(b, id), 'doing');
    b = backlog();
    moveItem(b, find(b, id), 'done');
    const h = history(join(root, 'backlog/stories/done/1.1.3-delete-note.md'));
    expect(h.map(e => e.subject)).toEqual(['ob: move 1.1.3 to done', 'ob: move 1.1.3 to doing', 'start']);
    expect(h[0]).toMatchObject({ author: 'Ana Silva', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it('pulls and pushes through the user\'s remote', () => {
    const remote = tmp();
    run(remote, 'init', '-q', '--bare', '-b', 'main');
    const a = repo();
    run(a.root, 'remote', 'add', 'origin', remote);
    run(a.root, 'push', '-q', '-u', 'origin', 'main');
    const b = tmp();
    run(b, 'clone', '-q', remote, '.');
    run(b, 'config', 'user.name', 'Raj Patel');
    run(b, 'config', 'user.email', 'raj@example.com');
    const theirs = loadBacklog(join(b, 'backlog'));
    moveItem(theirs, find(theirs, '1.1.3'), 'doing');
    push(b);
    pull(a.root);
    expect(existsSync(join(a.root, 'backlog/stories/doing/1.1.3-delete-note.md'))).toBe(true);
    expect(run(a.root, 'log', '-1', '--format=%an|%s')).toBe('Raj Patel|ob: move 1.1.3 to doing');
  });

  it('names git\'s own complaint when a git command fails', () => {
    const { root } = repo();
    expect(() => pull(root)).toThrow(BacklogError);
    expect(() => pull(root)).toThrow(/^git pull: /);
  });
});

describe('the next ID', () => {
  it('is one more than the highest under the parent', () => {
    const { backlog } = repo('t3-application');
    const b = backlog();
    expect(nextId(b, '1.1')).toBe('1.1.3');
    expect(nextId(b, '1.2')).toBe('1.2.3');
    expect(nextId(b, '1')).toBe('1.3');
    expect(nextId(b, '0.1')).toBe('0.1.2');
    expect(nextId(b, '1.3')).toBe('1.3.1');
    expect(nextId(b)).toBe('2');
    expect(nextId(b, undefined, true)).toBe('C2');
  });

  it('skips a pruned highest number, found in git history, so a number is never used twice', () => {
    const { root, backlog } = repo();
    expect(nextId(backlog(), '1.1')).toBe('1.1.4');
    run(root, 'rm', '-q', 'backlog/stories/todo/1.1.3-delete-note.md');
    run(root, 'commit', '-qm', 'prune 1.1.3');
    const b = backlog();
    expect(b.items.some(i => i.id === '1.1.3')).toBe(false);
    expect(usedIds(b).has('1.1.3')).toBe(true);
    expect(nextId(b, '1.1')).toBe('1.1.4');
  });

  it('counts a number whose file was renamed away, and reads 1.10 as ten', () => {
    const { root, backlog } = repo('tools/read-as-text');
    expect(nextId(backlog())).toBe('2');
    expect(nextId(backlog(), '1')).toBe('1.11');
    run(root, 'mv', 'backlog/features/1.10-export.md', 'backlog/features/1.10-export-csv.md');
    run(root, 'commit', '-qm', 'rename');
    expect(nextId(backlog(), '1')).toBe('1.11');
  });

  it('starts epics at 1, since epic 0 is for unplanned work', () => {
    const b = plain('t3-application');
    expect(b.items.filter(i => i.type === 'epic').map(i => i.id)).toEqual(['0', '1']);
    expect(nextId(b)).toBe('2');
    const empty = plain();
    for (const i of empty.items) rmSync(join(empty.dir, i.path));
    expect(nextId(loadBacklog(empty.dir))).toBe('1');
  });
});

describe('outside git', () => {
  it('does everything except committing: moves, next ID, new items, history', () => {
    const b = plain();
    const story = b.items.find(i => i.id === '1.1.3');
    if (!story) throw new Error('fixture changed');
    expect(moveItem(b, story, 'doing')).toEqual({ path: 'stories/doing/1.1.3-delete-note.md', committed: false });
    expect(existsSync(join(b.dir, 'stories/doing/1.1.3-delete-note.md'))).toBe(true);
    expect(nextId(b, '1.1')).toBe('1.1.4');
    expect(createItem(b.dir, { id: nextId(b, '1.1'), type: 'story', title: 'Pin a note', parent: '1.1' })).toBe('stories/todo/1.1.4-pin-a-note.md');
    expect(commit([join(b.dir, 'stories/todo/1.1.4-pin-a-note.md')], message.add('1.1.4', 'Pin a note'))).toBe(false);
    expect(history(join(b.dir, 'stories/doing/1.1.3-delete-note.md'))).toEqual([]);
    expect(isClean(b.dir)).toBe(true);
    expect(() => push(b.dir)).toThrow(/not in a git repository/);
  });

  it('moves an untracked file inside a repository with a plain rename', () => {
    const { root } = repo();
    writeFileSync(join(root, 'backlog/stories/todo/1.1.4-draft.md'), '---\nid: 1.1.4\ntype: story\ntitle: Draft\nparent: 1.1\n---\n');
    move(join(root, 'backlog/stories/todo/1.1.4-draft.md'), join(root, 'backlog/stories/doing/1.1.4-draft.md'));
    expect(readFileSync(join(root, 'backlog/stories/doing/1.1.4-draft.md'), 'utf8')).toContain('id: 1.1.4');
    expect(() => move(join(root, 'backlog/stories/doing/1.1.4-draft.md'), join(root, 'backlog/stories/done/1.1.1-new-note.md'))).toThrow(/already exists/);
  });
});

describe('where a status puts a story', () => {
  it('done goes under done/YYYY-MM/ when config.yml says done-folders: month', () => {
    const t3 = plain('t3-application'), t1 = plain();
    const day = new Date(2026, 10, 21);
    expect(statusPath(t3, find(t3, '1.1.2'), 'done', day)).toBe('stories/done/2026-11/1.1.2-cart-page.md');
    expect(statusPath(t1, find(t1, '1.1.2'), 'done', day)).toBe('stories/done/1.1.2-edit-note.md');
    expect(statusPath(t1, find(t1, '1.1.1'), 'todo', day)).toBe('stories/todo/1.1.1-new-note.md');
  });

  it('writes the commit messages the board and the CLI share', () => {
    expect(message.move('2.3.4', 'doing')).toBe('ob: move 2.3.4 to doing');
    expect(message.add('2.3.5', 'ob list')).toBe('ob: add 2.3.5 ob list');
    expect(message.edit('2.3.4', 'title')).toBe('ob: edit 2.3.4 title');
  });
});
