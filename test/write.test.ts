import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { BacklogError, createItem, formatValue, loadBacklog, newItemText, setFields, slugify, updateItem } from '../src/core/index.js';
import type { FieldValue } from '../src/core/index.js';
import { parseMapping, splitFrontMatter } from '../src/core/yaml.js';

const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));
const tmps: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'ob-write-')); tmps.push(d); return d; };
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }); });

const fields = (text: string) => parseMapping(splitFrontMatter(text)?.front ?? '') ?? {};
const body = (text: string) => splitFrontMatter(text)?.body;

/** Every Markdown file with front matter in the fixtures: items and sprints. */
const frontMatterFiles = (readdirSync(fixtures, { recursive: true }) as string[])
  .filter(f => f.endsWith('.md') && /(^|\/)backlog\//.test(f))
  .map(f => join(fixtures, f))
  .filter(f => readFileSync(f, 'utf8').startsWith('---'));

/** git diff --numstat for one change to a file: [added, removed]. */
function diffStat(before: string, after: string): [number, number] {
  const repo = tmp();
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  git('init', '-q');
  writeFileSync(join(repo, 'item.md'), before);
  git('add', 'item.md');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'before');
  writeFileSync(join(repo, 'item.md'), after);
  const [added, removed] = git('diff', '--numstat').trim().split('\t').map(Number);
  return [added ?? -1, removed ?? -1];
}

const CART = readFileSync(join(fixtures, 't3-application/backlog/stories/doing/1.1.2-cart-page.md'), 'utf8');

describe('saving without changes', () => {
  it('leaves every fixture file byte for byte identical', () => {
    expect(frontMatterFiles.length).toBeGreaterThan(80);
    for (const f of frontMatterFiles) {
      const text = readFileSync(f, 'utf8');
      expect(setFields(text, {}), f).toBe(text);
    }
  });

  it('leaves a file identical when each field is set to the value it already has', () => {
    for (const f of frontMatterFiles) {
      const text = readFileSync(f, 'utf8');
      let current: Record<string, unknown>;
      try { current = fields(text); } catch { continue; }
      for (const [k, v] of Object.entries(current)) {
        const writable = ['string', 'number', 'boolean'].includes(typeof v) || (Array.isArray(v) && v.every(x => typeof x === 'string'));
        if (writable) expect(setFields(text, { [k]: v as FieldValue }), `${f} ${k}`).toBe(text);
      }
    }
  });
});

describe('changing a field', () => {
  it('is a one-line git diff: change, add, remove', () => {
    expect(diffStat(CART, setFields(CART, { estimate: 8 }))).toEqual([1, 1]);
    expect(diffStat(CART, setFields(CART, { title: 'Cart page, with totals' }))).toEqual([1, 1]);
    expect(diffStat(CART, setFields(CART, { due: '2026-12-01' }))).toEqual([1, 0]);
    expect(diffStat(CART, setFields(CART, { rank: undefined }))).toEqual([0, 1]);
  });

  it('changes only the value: the rest of the line, other fields and the body stay', () => {
    const after = setFields(CART, { estimate: 8, assignee: 'raj' });
    expect(after).toBe(CART.replace('estimate: 5\n', 'estimate: 8\n').replace('assignee: ana\n', 'assignee: raj\n'));
    expect(body(after)).toBe(body(CART));
  });

  it('adds a new field at the end of the front matter, and removes one with its lines', () => {
    const added = setFields(CART, { release: '0.2.0' });
    expect(added).toBe(CART.replace('rank: 100\n---', 'rank: 100\nrelease: 0.2.0\n---'));
    const text = '---\nid: 1.1.1\nlinks:\n  design: https://example.com/a\n  spec: https://example.com/b\ntitle: X\n---\nBody\n';
    expect(setFields(text, { links: undefined })).toBe('---\nid: 1.1.1\ntitle: X\n---\nBody\n');
    expect(setFields(text, { missing: undefined })).toBe(text);
  });

  it('keeps a YAML comment after the value, other quoting, blank lines and CRLF line endings', () => {
    const text = '---\r\nid: 2.3.4\r\ntitle: "Quoted: as written"\r\n\r\nestimate: 3   # a rough guess\r\n---\r\n\r\nBody\r\n';
    const after = setFields(text, { estimate: 5, sprint: '2026-S24' });
    expect(after).toBe('---\r\nid: 2.3.4\r\ntitle: "Quoted: as written"\r\n\r\nestimate: 5   # a rough guess\r\nsprint: 2026-S24\r\n---\r\n\r\nBody\r\n');
  });

  it('fills an empty value after its colon', () => {
    expect(setFields('---\nid: 1\ndue:\ntitle: X\n---\n', { due: '2026-12-01' })).toBe('---\nid: 1\ndue: 2026-12-01\ntitle: X\n---\n');
  });

  it('[keep-unknown]: unknown fields, nested ones and their order survive any write', () => {
    const file = join(fixtures, 'tools/keep-unknown/backlog/stories/todo/1.1.1-sign-up-form.md');
    const text = readFileSync(file, 'utf8');
    const after = setFields(text, { title: 'Sign-up form, without JavaScript', assignee: 'jo', risk: 'low' });
    const f = fields(after);
    expect(Object.keys(f)).toEqual(['id', 'customer', 'type', 'title', 'risk', 'parent', 'links', 'assignee']);
    expect(f).toMatchObject({ customer: 'acme', risk: 'low', links: { design: 'https://example.com/designs/sign-up' } });
    expect(body(after)).toBe(body(text));
    expect(diffStat(text, after)).toEqual([3, 2]);
  });

  it('[read-as-text]: writes an ID as written, and it reads back as text', () => {
    const after = setFields('---\nid: 1.10.1\nparent: 1.1\n---\n', { parent: '1.10' });
    expect(after).toBe('---\nid: 1.10.1\nparent: 1.10\n---\n');
    expect(fields(after)['parent']).toBe('1.10');
  });

  it('quotes text only when YAML would misread it, writes lists in flow style, and refuses two lines', () => {
    expect(formatValue('title', 'ob move')).toBe('ob move');
    expect(formatValue('title', 'Fix: rounding')).toBe('"Fix: rounding"');
    expect(formatValue('title', 'yes')).toBe('"yes"');
    expect(formatValue('estimate', 3)).toBe('3');
    expect(formatValue('repo', ['shop-api', 'shop-web'])).toBe('[shop-api, shop-web]');
    expect(formatValue('release', '0.2.0')).toBe('0.2.0');
    expect(() => formatValue('title', 'two\nlines')).toThrow(/one line/);
    for (const v of ['Fix: rounding', 'yes', '#1 priority', 'a "quote"', "it's"]) {
      expect(fields(setFields('---\nid: 1\ntitle: X\n---\n', { title: v }))['title'], v).toBe(v);
    }
  });
});

describe('updating a file on disk', () => {
  it('writes only when something changed, and names the file when it cannot', () => {
    const dir = tmp();
    cpSync(join(fixtures, 't3-application/backlog'), join(dir, 'backlog'), { recursive: true });
    const backlog = loadBacklog(join(dir, 'backlog'));
    const cart = backlog.items.find(i => i.id === '1.1.2');
    if (!cart) throw new Error('fixture changed');
    expect(updateItem(backlog.dir, cart, { estimate: 5 })).toBe(false);
    expect(updateItem(backlog.dir, cart, { estimate: 8 })).toBe(true);
    expect(loadBacklog(backlog.dir).items.find(i => i.id === '1.1.2')?.fields['estimate']).toBe(8);
    writeFileSync(join(backlog.dir, cart.path), 'no front matter\n');
    expect(() => updateItem(backlog.dir, cart, { estimate: 3 })).toThrow(BacklogError);
    expect(() => updateItem(backlog.dir, cart, { estimate: 3 })).toThrow(/stories\/doing\/1\.1\.2-cart-page\.md: has no front matter/);
  });
});

describe('new items', () => {
  it('writes a story in the recommended shape, as the site\'s story maker does', () => {
    expect(newItemText({
      id: '2.3.5', type: 'story', title: 'ob list', parent: '2.3', fields: { estimate: 3, repo: ['cli'] },
      asA: 'backlog user', wantTo: ['list the stories in a folder'], soThat: ['Verify ob list shows todo first'],
    })).toBe(`---
id: 2.3.5
type: story
title: ob list
parent: 2.3
estimate: 3
repo: [cli]
---

**As a** backlog user, **I want to:**
- list the stories in a folder

**So that:**
- Verify ob list shows todo first

## Comments
`);
    expect(newItemText({ id: '1.1.4', type: 'bug', title: 'Crash', parent: '1.1' })).toContain('**As a** <who>, **I want to:**\n- <what they want>');
  });

  it('writes an epic, feature or capability as front matter only', () => {
    expect(newItemText({ id: '2', type: 'epic', title: 'Build' })).toBe('---\nid: 2\ntype: epic\ntitle: Build\n---\n');
  });

  it('files each type in its folder, never overwrites, and reads back with no errors', () => {
    const dir = join(tmp(), 'backlog');
    cpSync(join(fixtures, 't1-minimal/backlog'), dir, { recursive: true });
    expect(createItem(dir, { id: '2', type: 'epic', title: 'Grow' })).toBe('epics/2-grow.md');
    expect(createItem(dir, { id: '2.1', type: 'feature', title: 'Share a note', parent: '2' })).toBe('features/2.1-share-a-note.md');
    expect(createItem(dir, { id: '2.1.1', type: 'spike', title: 'Which link format?', parent: '2.1' })).toBe('stories/todo/2.1.1-which-link-format.md');
    expect(createItem(dir, { id: 'C1', type: 'capability', title: 'Notes', slug: 'notes' })).toBe('capabilities/C1-notes.md');
    expect(() => createItem(dir, { id: '2', type: 'epic', title: 'Grow' })).toThrow(/epics\/2-grow\.md: already exists/);
    const b = loadBacklog(dir);
    expect(b.errors).toEqual([]);
    expect(b.items.find(i => i.id === '2.1.1')).toMatchObject({ type: 'spike', title: 'Which link format?', parent: '2.1', status: 'todo' });
  });

  it('makes a slug as the site does', () => {
    expect(slugify('ob move')).toBe('ob-move');
    expect(slugify('Café: the Über-long title with many many words')).toBe('cafe-the-uber-long-title-with');
  });
});
