import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { BacklogError, compareIds, findBacklog, loadBacklog, parseFileName, readBacklog, statusOf } from '../src/core/index.js';

const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));
const fx = (...parts: string[]) => join(fixtures, ...parts);
const load = (name: string) => loadBacklog(fx(name, 'backlog'));
const summary = (name: string) => load(name).items.map(i => [i.id, i.type, i.status ?? '-']);

/** Every backlog folder among the fixtures: a folder named backlog with a config.yml. */
function backlogsUnder(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter(f => f.endsWith(join('backlog', 'config.yml')))
    .map(f => join(dir, f.slice(0, -'/config.yml'.length)));
}

const tmps: string[] = [];
function tmpBacklog(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ob-read-'));
  tmps.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }); });

describe('finding the backlog', () => {
  it('walks up from any folder in the repository, inside backlog/ included', () => {
    const backlog = fx('t1-minimal', 'backlog');
    for (const from of [fx('t1-minimal'), backlog, fx('t1-minimal', 'backlog', 'stories', 'todo')]) {
      expect(findBacklog(from), from).toBe(backlog);
    }
    expect(readBacklog(fx('t1-minimal', 'backlog', 'epics')).config.name).toBe('notes');
  });

  it('says where it looked when there is no backlog', () => {
    const empty = tmpBacklog({ 'src/app.ts': '' });
    expect(() => findBacklog(join(empty, 'src'))).toThrow(BacklogError);
    expect(() => findBacklog(join(empty, 'src'))).toThrow(/no backlog\/config\.yml in .*src or any folder above it/);
  });
});

describe('the valid examples', () => {
  it('t1-minimal: one epic, one feature, a story in each status', () => {
    expect(summary('t1-minimal')).toEqual([
      ['1', 'epic', '-'], ['1.1', 'feature', '-'],
      ['1.1.1', 'story', 'done'], ['1.1.2', 'story', 'doing'], ['1.1.3', 'story', 'todo'],
    ]);
    const b = load('t1-minimal');
    expect(b.config).toEqual({ spec: '0.1', name: 'notes' });
    expect(b.errors).toEqual([]);
    expect(b.items.find(i => i.id === '1.1.2')?.body).toContain('**As a** note taker');
  });

  it('t3-application: capabilities first, epic 0, done/ subfolders, sprints, people and repos', () => {
    expect(summary('t3-application')).toEqual([
      ['C1', 'capability', '-'],
      ['0', 'epic', '-'], ['0.1', 'feature', '-'], ['0.1.1', 'bug', 'todo'],
      ['1', 'epic', '-'], ['1.1', 'feature', '-'], ['1.1.1', 'story', 'done'], ['1.1.2', 'story', 'doing'],
      ['1.2', 'feature', '-'], ['1.2.1', 'story', 'todo'], ['1.2.2', 'spike', 'todo'],
    ]);
    const b = load('t3-application');
    expect(b.items.find(i => i.id === '1.1.1')?.path).toBe('stories/done/2026-11/1.1.1-cart-api.md');
    const cart = b.items.find(i => i.id === '1.1.2');
    expect(cart?.parent).toBe('1.1');
    expect(cart?.fields).toMatchObject({ repo: 'shop-web', estimate: 5, assignee: 'ana', sprint: '2026-S24', rank: 100 });
    expect(cart?.file).toEqual({ id: '1.1.2', slug: 'cart-page' });
    expect(Object.keys(b.config.repos ?? {})).toEqual(['shop-api', 'shop-web', 'shop-ios']);
    expect(b.config['done-folders']).toBe('month');
    expect(b.people).toEqual({ ana: { name: 'Ana Silva', forge: 'ana-silva' }, raj: { name: 'Raj Patel' } });
    expect(b.sprints).toHaveLength(1);
    expect(b.sprints[0]).toMatchObject({ name: '2026-S24', fields: { start: '2026-11-16', end: '2026-11-27' } });
    expect(b.errors).toEqual([]);
  });

  it('t4-portfolio: the portfolio and both app backlogs load on their own', () => {
    const portfolio = load('t4-portfolio/portfolio');
    expect(Object.keys(portfolio.config.backlogs ?? {})).toEqual(['notes', 'photos']);
    expect(portfolio.items.map(i => [i.id, i.status ?? '-'])).toEqual([['C1', '-'], ['1', '-'], ['1.1', '-'], ['1.1.1', 'doing']]);
    expect(load('t4-portfolio/photos').items.filter(i => i.status).map(i => [i.id, i.status])).toEqual([['1.1.1', 'done'], ['1.1.2', 'doing']]);
    expect(load('t4-portfolio/notes').items).toHaveLength(4);
  });

  it('reads every valid backlog with no file errors', () => {
    const valid = backlogsUnder(fixtures).filter(d => !d.includes(`${join('fixtures', 'invalid')}`));
    expect(valid.length).toBeGreaterThanOrEqual(9);
    for (const dir of valid) expect(loadBacklog(dir).errors, dir).toEqual([]);
  });
});

describe('the tool checks', () => {
  it('[read-as-text]: 1.10 is not 1.1, and comes after it', () => {
    const b = load('tools/read-as-text');
    expect(b.items.map(i => i.id)).toEqual(['1', '1.1', '1.1.1', '1.10', '1.10.1']);
    expect(b.items.find(i => i.id === '1.10.1')?.parent).toBe('1.10');
    expect(b.config.spec).toBe('0.1');
  });

  it('[keep-unknown]: every field is kept, in file order, nested ones too', () => {
    const b = load('tools/keep-unknown');
    const story = b.items.find(i => i.id === '1.1.1');
    expect(Object.keys(story?.fields ?? {})).toEqual(['id', 'customer', 'type', 'title', 'risk', 'parent', 'links']);
    expect(story?.fields['links']).toEqual({ design: 'https://example.com/designs/sign-up' });
    expect(b.config['board-colour']).toBe('teal');
  });
});

describe('broken backlogs', () => {
  it('loads every invalid example without throwing; only [front-matter] has a file it cannot read', () => {
    const invalid = backlogsUnder(fx('invalid'));
    expect(invalid.length).toBeGreaterThanOrEqual(15);
    for (const dir of invalid) {
      const b = loadBacklog(dir);
      if (dir.includes(join('invalid', 'front-matter'))) {
        expect(b.errors).toEqual([{ path: 'stories/todo/1.1.2-confirm-email.md', message: expect.stringContaining('no front matter') }]);
        expect(b.items.map(i => i.id)).toEqual(['1', '1.1', '1.1.1']);
      } else {
        expect(b.errors, dir).toEqual([]);
      }
    }
  });

  it('keeps an item outside a status folder, with no status ([item-folder] is for validation)', () => {
    const story = load('invalid/item-folder').items.find(i => i.id === '1.1.1');
    expect(story?.path).toBe('stories/todo/next/1.1.1-sign-up-form.md');
    expect(story?.status).toBeUndefined();
  });

  it('reads a config without a name ([config] is for validation)', () => {
    expect(load('invalid/config').config).toEqual({ spec: '0.1' });
  });

  it('stops with an error naming config.yml when it is missing or not YAML', () => {
    const none = tmpBacklog({ 'backlog/epics/1-launch.md': '---\nid: 1\ntype: epic\ntitle: Launch\n---\n' });
    expect(() => loadBacklog(join(none, 'backlog'))).toThrow(/backlog\/config\.yml: not found/);
    const bad = tmpBacklog({ 'backlog/config.yml': 'spec: 0.1\nname: [unclosed\n' });
    expect(() => loadBacklog(join(bad, 'backlog'))).toThrow(BacklogError);
    expect(() => loadBacklog(join(bad, 'backlog'))).toThrow(/config\.yml: not valid YAML: /);
    const list = tmpBacklog({ 'backlog/config.yml': '- spec\n- name\n' });
    expect(() => loadBacklog(join(list, 'backlog'))).toThrow(/config\.yml: must be a YAML mapping/);
  });

  it('skips a file it cannot parse, names it, and loads the rest', () => {
    const root = tmpBacklog({
      'backlog/config.yml': 'spec: 0.1\nname: demo\n',
      'backlog/people.yml': 'ana: [\n',
      'backlog/epics/1-launch.md': '---\nid: 1\ntype: epic\ntitle: Launch\n---\n',
      'backlog/features/1.1-x.md': '---\nid: 1.1\ntitle: "unclosed\n---\n',
      'backlog/features/1.2-y.md': '---\n- a list\n---\n',
      'backlog/sprints/2026-S1.md': 'no front matter\n',
    });
    const b = loadBacklog(join(root, 'backlog'));
    expect(b.items.map(i => i.id)).toEqual(['1']);
    expect(b.errors.map(e => e.path).sort()).toEqual(['features/1.1-x.md', 'features/1.2-y.md', 'people.yml', 'sprints/2026-S1.md']);
    expect(b.errors.find(e => e.path === 'features/1.1-x.md')?.message).toMatch(/^front matter is not valid YAML: /);
    expect(b.errors.find(e => e.path === 'features/1.2-y.md')?.message).toBe('front matter is not a YAML mapping of fields');
    expect(b.people).toEqual({});
  });
});

describe('IDs, file names and status', () => {
  it('orders IDs part by part, capabilities first', () => {
    expect(['1.10', '2', 'C2', '1.2', '1', 'C10', '1.2.1', '0'].sort(compareIds)).toEqual(['C2', 'C10', '0', '1', '1.2', '1.2.1', '1.10', '2']);
  });

  it('reads the ID and slug from a file name', () => {
    expect(parseFileName('2.3.4-ob-move.md')).toEqual({ id: '2.3.4', slug: 'ob-move' });
    expect(parseFileName('C1-identity.md')).toEqual({ id: 'C1', slug: 'identity' });
    expect(parseFileName('0.1-2026-11.md')).toEqual({ id: '0.1', slug: '2026-11' });
    expect(parseFileName('README.md')).toBeNull();
  });

  it('gives todo and doing only directly in their folder, done at any depth', () => {
    expect(statusOf('stories/todo/1.1.1-a.md')).toBe('todo');
    expect(statusOf('stories/doing/1.1.1-a.md')).toBe('doing');
    expect(statusOf('stories/done/1.1.1-a.md')).toBe('done');
    expect(statusOf('stories/done/2026/11/1.1.1-a.md')).toBe('done');
    expect(statusOf('stories/todo/next/1.1.1-a.md')).toBeUndefined();
    expect(statusOf('stories/1.1.1-a.md')).toBeUndefined();
    expect(statusOf('features/1.1-a.md')).toBeUndefined();
  });
});
