import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { afterEach, describe, expect, it } from 'vitest';

import { formatProblem, RULE, RULES, validateDir } from '../src/core/index.js';
import type { Problem } from '../src/core/index.js';

const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));
const backlogs = (readdirSync(fixtures, { recursive: true }) as string[])
  .filter(f => f.endsWith(join('backlog', 'config.yml')))
  .map(f => f.slice(0, -'/config.yml'.length)).sort();
const invalid = backlogs.filter(b => b.startsWith('invalid/'));
const valid = backlogs.filter(b => !b.startsWith('invalid/'));
const check = (rel: string) => validateDir(join(fixtures, rel)).problems;
const errors = (ps: Problem[]) => ps.filter(p => p.severity === 'error');

const tmps: string[] = [];
function backlog(files: Record<string, string>): string {
  const root = join(mkdtempSync(join(tmpdir(), 'ob-validate-')), 'repo');
  tmps.push(join(root, '..'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, 'backlog', path, '..'), { recursive: true });
    writeFileSync(join(root, 'backlog', path), text);
  }
  return join(root, 'backlog');
}
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }); });
const fm = (fields: string, body = '') => `---\n${fields}\n---\n${body}`;
const BASE = {
  'config.yml': 'spec: 0.1\nname: demo\n',
  'epics/1-launch.md': fm('id: 1\ntype: epic\ntitle: Launch'),
  'features/1.1-sign-up.md': fm('id: 1.1\ntype: feature\ntitle: Sign up\nparent: 1'),
};

describe('the examples', () => {
  it('every valid backlog has no errors', () => {
    expect(valid.length).toBeGreaterThanOrEqual(9);
    for (const b of valid) expect(errors(check(b)).map(formatProblem), b).toEqual([]);
  });

  it('each invalid/<rule>/ raises exactly its own code, and only errors', () => {
    expect(invalid.map(b => b.split('/')[1]).sort()).toEqual(RULES.filter(r => r.severity === 'error').map(r => r.rule).sort());
    for (const b of invalid) {
      const rule = b.split('/')[1] ?? '';
      const ps = check(b);
      expect([...new Set(ps.map(p => p.code))], b).toEqual([RULE[rule]?.code]);
      expect(ps.every(p => p.severity === 'error'), b).toBe(true);
    }
  });

  it('[local-clones]: a listed backlog with no local clone is a warning, not an error', () => {
    const ps = check('tools/local-clones/portfolio/backlog');
    expect(ps.map(p => [p.code, p.severity, p.path])).toEqual([['OB017', 'warning', 'config.yml']]);
    expect(ps[0]?.message).toContain('photos');
    expect(check('t4-portfolio/portfolio/backlog')).toEqual([]);
  });
});

describe('messages', () => {
  it('name the file and say how to fix it', () => {
    for (const b of backlogs) {
      for (const p of check(b)) {
        expect(existsSync(join(fixtures, b, p.path)), `${b}: ${p.path}`).toBe(true);
        const line = formatProblem(p);
        expect(line.startsWith(`${p.path}: ${p.code} [${p.rule}] `), line).toBe(true);
        expect(line).toMatch(/\. Fix: .+\.$/);
        expect(p.fix.length).toBeGreaterThan(20);
      }
    }
  });

  it('have stable codes, one per rule, in spec order', () => {
    expect(RULES.map(r => `${r.code} ${r.rule}`)).toEqual([
      'OB001 parent', 'OB002 parent-exists', 'OB003 id-form', 'OB004 id-unique', 'OB005 epic-zero', 'OB006 filename',
      'OB007 front-matter', 'OB008 fields', 'OB009 repo-listed', 'OB010 not-stored', 'OB011 no-email', 'OB012 comment-line',
      'OB013 sprints', 'OB014 people', 'OB015 item-folder', 'OB016 config', 'OB017 local-clones',
    ]);
  });
});

describe('the JSON Schema', () => {
  it("is backlog-spec's own, published at openbacklog.org", () => {
    for (const n of ['item', 'config']) {
      const s = JSON.parse(readFileSync(new URL(`../schema/0.1/${n}.schema.json`, import.meta.url), 'utf8'));
      expect(s.$id).toBe(`https://openbacklog.org/schema/0.1/${n}.schema.json`);
    }
  });

  it('agrees with any tool using it: a file the schema rejects has a problem, one it accepts has no schema-only problem', async () => {
    const { loadBacklog } = await import('../src/core/index.js');
    const ajv = new Ajv({ allErrors: true, strict: false });
    const item = ajv.compile(JSON.parse(readFileSync(new URL('../schema/0.1/item.schema.json', import.meta.url), 'utf8')));
    const schemaOnly = new Set(['OB003', 'OB008', 'OB010']);
    let rejected = 0;
    for (const b of backlogs) {
      const loaded = loadBacklog(join(fixtures, b));
      const ps = check(b);
      for (const i of loaded.items) {
        const mine = ps.filter(p => p.path === i.path);
        if (!item(i.fields)) {
          rejected++;
          expect(mine.length, `${b} ${i.path}`).toBeGreaterThan(0);
        } else {
          expect(mine.filter(p => schemaOnly.has(p.code)), `${b} ${i.path}`).toEqual([]);
        }
      }
    }
    expect(rejected).toBeGreaterThanOrEqual(10);
  });
});

describe('rules that span files', () => {
  it('[parent]: a parent whose id looks right but whose item is the wrong type', () => {
    const dir = backlog({ ...BASE,
      'features/1.2-sign-in.md': fm('id: 1.2\ntype: feature\ntitle: Sign in\nparent: 1'),
      'stories/todo/1.1.1-form.md': fm('id: 1.1.1\ntype: story\ntitle: Form\nparent: 1.1'),
      'stories/todo/1.2.1-x.md': fm('id: 1.2.1\ntype: story\ntitle: X\nparent: 1.2'),
    });
    expect(validateDir(dir).problems).toEqual([]);
    writeFileSync(join(dir, 'features/1.2-sign-in.md'), fm('id: 1.2\ntype: epic\ntitle: Sign in'));
    const codes = validateDir(dir).problems.map(p => `${p.code} ${p.path}`);
    expect(codes).toContain('OB001 stories/todo/1.2.1-x.md');
    expect(codes).toContain('OB003 features/1.2-sign-in.md');
  });

  it('[config]: a missing or unreadable config.yml is a problem, not a crash', () => {
    const none = backlog({ 'epics/1-launch.md': BASE['epics/1-launch.md'] });
    expect(validateDir(none)).toMatchObject({ backlog: null, problems: [{ code: 'OB016', path: 'config.yml' }] });
    expect(validateDir(none).problems[0]?.message).toContain('not found');
    const bad = backlog({ 'config.yml': 'spec: [\n' });
    expect(validateDir(bad).problems.map(p => p.code)).toEqual(['OB016']);
    expect(validateDir(backlog({ 'config.yml': 'spec: 1\nname: Demo\nestimate: weeks\n' })).problems.map(p => p.field).sort()).toEqual(['estimate', 'name', 'spec']);
  });

  it('[sprints] and [people]: a broken sprint file or people.yml names the file', () => {
    const dir = backlog({ ...BASE,
      'sprints/2026-S1.md': 'no front matter\n',
      'sprints/2026-S2.md': fm('goal: Ship'),
      'people.yml': 'Jo Smith:\n  name: Jo\nana: {}\n',
    });
    const ps = validateDir(dir).problems.map(p => `${p.code} ${p.path} ${p.field ?? ''}`);
    expect(ps).toEqual(expect.arrayContaining([
      'OB013 sprints/2026-S1.md ', 'OB013 sprints/2026-S2.md start', 'OB013 sprints/2026-S2.md end',
      'OB014 people.yml Jo Smith', 'OB014 people.yml ana',
    ]));
  });

  it('[repo-listed]: every name in a repo list is checked', () => {
    const dir = backlog({ ...BASE, 'config.yml': 'spec: 0.1\nname: shop\nrepos:\n  shop-api: git@example.com:a.git\n',
      'stories/todo/1.1.1-form.md': fm('id: 1.1.1\ntype: story\ntitle: Form\nparent: 1.1\nrepo: [shop-api, shop-web]') });
    expect(validateDir(dir).problems.map(p => p.message)).toEqual(['repo shop-web is not a key of repos: in config.yml']);
  });

  it('[item-folder]: each type in its own folder', () => {
    const dir = backlog({ ...BASE,
      'features/1-wrong.md': fm('id: 1\ntype: epic\ntitle: Wrong'),
      'stories/1.1.1-loose.md': fm('id: 1.1.1\ntype: story\ntitle: Loose\nparent: 1.1'),
      'stories/done/2026/11/1.1.2-deep.md': fm('id: 1.1.2\ntype: story\ntitle: Deep\nparent: 1.1'),
    });
    const ps = validateDir(dir).problems.filter(p => p.code === 'OB015').map(p => p.path);
    expect(ps).toEqual(['features/1-wrong.md', 'stories/1.1.1-loose.md']);
  });

  it('orders problems by file, then code', () => {
    const ps = check('invalid/not-stored/backlog');
    expect(ps.map(p => p.path)).toEqual([...ps.map(p => p.path)].sort());
  });
});
