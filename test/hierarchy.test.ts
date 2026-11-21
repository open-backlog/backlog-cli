import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildOrder, buildTree, columnOrder, loadBacklog, progressOf, walk } from '../src/core/index.js';
import type { Item, Node, Status, Tree } from '../src/core/index.js';

const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));
const load = (name: string) => loadBacklog(join(fixtures, name, 'backlog'));

/** The node for an ID, failing the test if there is none. */
function nodeOf(tree: Tree, id: string): Node {
  const n = tree.byId.get(id);
  if (!n) throw new Error(`no item ${id}`);
  return n;
}

/** A minimal item, as the reader gives it. */
function item(id: string, type: string, parent?: string, status?: Status, fields: Record<string, unknown> = {}): Item {
  const i: Item = { id, type, title: id, fields: { id, type, ...fields }, body: '', path: `${id}.md`, file: null, folder: 'stories' };
  if (parent !== undefined) i.parent = parent;
  if (status) i.status = status;
  return i;
}

describe('the hierarchy', () => {
  it('links each item to its parent and gives each its children, by ID', () => {
    const tree = buildTree(load('t3-application').items);
    const ids = (id: string) => tree.byId.get(id)?.children.map(c => c.item.id);
    expect(tree.roots.map(r => r.item.id)).toEqual(['C1', '0']);
    expect(ids('C1')).toEqual(['1']);
    expect(ids('1')).toEqual(['1.1', '1.2']);
    expect(ids('1.1')).toEqual(['1.1.1', '1.1.2']);
    expect(ids('0')).toEqual(['0.1']);
    expect(tree.byId.get('1.2.2')?.parent?.item.id).toBe('1.2');
    expect(tree.orphans).toEqual([]);
  });

  it('keeps an item whose parent is missing as a root, and lists it as an orphan', () => {
    const tree = buildTree([item('1', 'epic'), item('1.1', 'feature', '1'), item('1.2.1', 'story', '1.2', 'todo')]);
    expect(tree.roots.map(r => r.item.id)).toEqual(['1', '1.2.1']);
    expect(tree.orphans.map(o => o.item.id)).toEqual(['1.2.1']);
  });

  it('walks the tree depth first, with each depth', () => {
    expect(walk(buildTree(load('t1-minimal').items)).map(w => `${'  '.repeat(w.depth)}${w.node.item.id}`)).toEqual(
      ['1', '  1.1', '    1.1.1', '    1.1.2', '    1.1.3']);
  });
});

describe('progress', () => {
  it('a feature with 2 of 5 stories done reports 40%, and is in progress', () => {
    const items = [item('1.1', 'feature', '1'),
      ...['done', 'done', 'doing', 'todo', 'todo'].map((s, n) => item(`1.1.${n + 1}`, 'story', '1.1', s as Status))];
    const p = progressOf(nodeOf(buildTree(items), '1.1'));
    expect(p).toMatchObject({ done: 2, doing: 1, todo: 2, total: 5, percent: 40, status: 'doing' });
  });

  it('an empty feature reports 0 of 0, todo, not an error', () => {
    expect(progressOf(nodeOf(buildTree([item('1.1', 'feature', '1')]), '1.1')))
      .toEqual({ done: 0, doing: 0, todo: 0, total: 0, percent: 0, estimate: { done: 0, total: 0 }, status: 'todo' });
  });

  it('adds up through epics and capabilities, counting and by estimate', () => {
    const tree = buildTree(load('t3-application').items);
    const p = (id: string) => progressOf(nodeOf(tree, id));
    expect(p('1.1')).toMatchObject({ done: 1, doing: 1, todo: 0, total: 2, percent: 50, estimate: { done: 3, total: 8 }, status: 'doing' });
    expect(p('1.2')).toMatchObject({ done: 0, total: 2, percent: 0, estimate: { done: 0, total: 10 }, status: 'todo' });
    expect(p('1')).toMatchObject({ done: 1, doing: 1, todo: 2, total: 4, percent: 25, estimate: { done: 3, total: 18 }, status: 'doing' });
    expect(p('C1')).toEqual(p('1'));
    expect(p('0')).toMatchObject({ total: 1, percent: 0, status: 'todo' });
  });

  it('an epic is done only when all its features are: an empty feature keeps it open', () => {
    const items = [item('1', 'epic'), item('1.1', 'feature', '1'), item('1.1.1', 'story', '1.1', 'done'), item('1.2', 'feature', '1')];
    const tree = buildTree(items);
    expect(progressOf(nodeOf(tree, '1.1')).status).toBe('done');
    expect(progressOf(nodeOf(tree, '1'))).toMatchObject({ done: 1, total: 1, percent: 100, status: 'doing' });
    expect(progressOf(nodeOf(buildTree(items.slice(0, 3)), '1')).status).toBe('done');
  });

  it('rounds the percentage: 1 of 3 is 33%', () => {
    const items = [item('1.1', 'feature', '1'), item('1.1.1', 'task', '1.1', 'done'), item('1.1.2', 'bug', '1.1', 'todo'), item('1.1.3', 'spike', '1.1', 'todo')];
    expect(progressOf(nodeOf(buildTree(items), '1.1')).percent).toBe(33);
  });
});

describe('order', () => {
  it('is the build order: by number at every level, not alphabetically', () => {
    expect(buildOrder(load('t3-application').items).map(i => i.id)).toEqual(
      ['C1', '0', '0.1', '0.1.1', '1', '1.1', '1.1.1', '1.1.2', '1.2', '1.2.1', '1.2.2']);
    expect(buildOrder(load('tools/read-as-text').items).map(i => i.id)).toEqual(['1', '1.1', '1.1.1', '1.10', '1.10.1']);
    const shuffled = ['2.3.10', '2.10', '2.3.9', '10', '2', '2.3', '9'].map(id => item(id, 'story'));
    expect(buildOrder(shuffled).map(i => i.id)).toEqual(['2', '2.3', '2.3.9', '2.3.10', '2.10', '9', '10']);
  });

  it('within a column, ranked items come first, lowest rank first, then by ID', () => {
    const column = [item('1.1.3', 'story', '1.1', 'todo'), item('1.1.1', 'story', '1.1', 'todo', { rank: 200 }),
      item('1.1.2', 'story', '1.1', 'todo'), item('1.1.4', 'story', '1.1', 'todo', { rank: 100 })];
    expect(columnOrder(column).map(i => i.id)).toEqual(['1.1.4', '1.1.1', '1.1.2', '1.1.3']);
  });
});
