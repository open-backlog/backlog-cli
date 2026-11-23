import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { packageVersion, run } from '../src/cli/run.js';
import { hookText, INIT_FOLDERS, initBacklog, initDir, loadBacklog, validateDir } from '../src/core/index.js';

const tmps: string[] = [];
/** A new empty folder, as a real path (macOS /var is /private/var). */
function tmp(name = 'my-app'): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'ob-init-')));
  tmps.push(d);
  mkdirSync(join(d, name));
  return join(d, name);
}
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }); });

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });

function ob(cwd: string, ...args: string[]) {
  let out = '', err = '';
  const code = run(['init', ...args], { out: t => { out += t; }, err: t => { err += t; }, cwd });
  return { code, out, err };
}

/** Every file under a folder with its text, to show that nothing changed. */
function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries((readdirSync(dir, { recursive: true }) as string[]).sort()
    .map(f => [f, statSync(join(dir, f)).isFile() ? readFileSync(join(dir, f), 'utf8') : '/']));
}

const FILES = ['config.yml', ...INIT_FOLDERS.map(f => `${f}/.gitkeep`)];

describe('ob init', () => {
  it('creates backlog/ with a two-line config.yml and the folders, and it validates', () => {
    const root = tmp();
    git(root, 'init', '-q');
    const r = ob(root, '--name', 'my-app');
    expect(r).toMatchObject({ code: 0, err: '' });
    expect(r.out).toContain('Created the my-app backlog in backlog/:');
    expect(r.out).toContain('Next: git add backlog && git commit');
    expect(readFileSync(join(root, 'backlog', 'config.yml'), 'utf8')).toBe('spec: 0.1\nname: my-app\n');
    for (const f of FILES) expect(readFileSync(join(root, 'backlog', f), 'utf8'), f).toBe(f === 'config.yml' ? 'spec: 0.1\nname: my-app\n' : '');
    expect(existsSync(join(root, 'backlog', 'README.md'))).toBe(false);
    expect(validateDir(join(root, 'backlog')).problems).toEqual([]);
    expect(loadBacklog(join(root, 'backlog')).config).toEqual({ spec: '0.1', name: 'my-app' });
    // Every folder is kept by git, so the empty backlog survives a commit and a clone.
    expect(git(root, 'status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean).sort())
      .toEqual(FILES.map(f => `?? backlog/${f}`).sort());
  });

  it('a second run changes nothing and says so', () => {
    const root = tmp();
    git(root, 'init', '-q');
    ob(root, '--name', 'my-app', '--readme');
    writeFileSync(join(root, 'backlog', 'epics', '1-launch.md'), '---\nid: 1\ntype: epic\ntitle: Launch\n---\n');
    const before = snapshot(root);
    for (const args of [[], ['--name', 'other'], ['--readme']]) {
      const r = ob(root, ...args);
      expect(r).toEqual({ code: 0, out: 'backlog/ already exists (my-app): nothing changed.\n', err: '' });
      expect(snapshot(root)).toEqual(before);
    }
  });

  it('in a code repo, puts backlog/ at the top of the repository and leaves the code alone', () => {
    const root = tmp('shop');
    git(root, 'init', '-q');
    mkdirSync(join(root, 'src', 'lib'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{ "name": "shop" }\n');
    writeFileSync(join(root, 'src', 'lib', 'index.js'), 'export {};\n');
    const r = ob(join(root, 'src', 'lib'));
    expect(r.code).toBe(0);
    expect(r.out).toContain('Created the shop backlog in ../../backlog/:');
    expect(initDir(join(root, 'src', 'lib'))).toBe(join(root, 'backlog'));
    expect(readFileSync(join(root, 'backlog', 'config.yml'), 'utf8')).toBe('spec: 0.1\nname: shop\n');
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe('{ "name": "shop" }\n');
    expect(existsSync(join(root, 'src', 'lib', 'backlog'))).toBe(false);
    expect(validateDir(join(root, 'backlog')).problems).toEqual([]);
  });

  it('outside git, creates it here and suggests git init', () => {
    const dir = tmp('Notes App');
    const r = ob(dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Created the notes-app backlog in backlog/:');
    expect(r.out).toContain('Not in a git repository: run git init');
    expect(validateDir(join(dir, 'backlog')).problems).toEqual([]);
  });

  it('--readme adds a README that explains the folders and is not read as an item', () => {
    const root = tmp();
    const r = ob(root, '--readme');
    expect(r.out).toContain('  README.md\n');
    const readme = readFileSync(join(root, 'backlog', 'README.md'), 'utf8');
    for (const word of ['config.yml', 'epics/', 'features/', 'todo/', 'doing/', 'done/', 'ob --help']) expect(readme).toContain(word);
    expect(validateDir(join(root, 'backlog')).problems).toEqual([]);
    expect(loadBacklog(join(root, 'backlog')).items).toEqual([]);
  });

  it('refuses a bad name before writing anything (exit 1), and bad usage with exit 2', () => {
    const root = tmp();
    for (const name of ['My App', 'my_app', 'x-', '']) {
      const r = ob(root, '--name', name);
      expect(r.code, name).toBe(1);
      expect(r.err).toContain("can't be a backlog name");
    }
    const unnamed = tmp('---');
    expect(ob(unnamed).err).toContain('choose one with --name');
    expect(existsSync(join(root, 'backlog'))).toBe(false);
    expect(existsSync(join(unnamed, 'backlog'))).toBe(false);
    expect(ob(root, 'extra')).toMatchObject({ code: 2, err: expect.stringContaining('ob init --help') });
    expect(ob(root, '--nope')).toMatchObject({ code: 2, err: expect.stringContaining('ob init --help') });
    expect(ob(root, '--help')).toMatchObject({ code: 0, out: expect.stringContaining('Usage: ob init') });
  });

  it('completes a backlog/ folder that has no config.yml yet, keeping what is there', () => {
    const root = tmp();
    mkdirSync(join(root, 'backlog', 'epics'), { recursive: true });
    writeFileSync(join(root, 'backlog', 'epics', '.gitkeep'), 'mine\n');
    const r = initBacklog(join(root, 'backlog'), { name: 'my-app' });
    expect(r).toMatchObject({ existed: false, name: 'my-app' });
    expect(r.created).toEqual(FILES.filter(f => f !== 'epics/.gitkeep'));
    expect(readFileSync(join(root, 'backlog', 'epics', '.gitkeep'), 'utf8')).toBe('mine\n');
  });
});

describe('ob init --hook (3.1.2)', () => {
  it('installs a pre-commit hook that runs ob validate, using ob or else npx at this version line', () => {
    const root = tmp();
    git(root, 'init', '-q');
    mkdirSync(join(root, 'src'));
    const r = ob(join(root, 'src'), '--hook');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Created the my-app backlog in ../backlog/:');
    expect(r.out).toContain('Installed the pre-commit hook ../.git/hooks/pre-commit: ob validate runs before each commit');
    const hook = join(root, '.git', 'hooks', 'pre-commit');
    expect(statSync(hook).mode & 0o111).toBeTruthy();
    expect(readFileSync(hook, 'utf8')).toBe(hookText(packageVersion()));
    expect(hookText('0.3.2')).toMatch(/^#!\/bin\/sh\n[\s\S]*\nif command -v ob >\/dev\/null 2>&1; then exec ob validate; fi\nexec npx --yes -p open-backlog@0\.3 ob validate\n$/);

    // Again, or in another clone of a repository whose backlog exists: the hook alone.
    expect(ob(root, '--hook').out).toBe('backlog/ already exists (my-app): kept as it is.\nThe pre-commit hook .git/hooks/pre-commit already runs ob validate: nothing changed.\n');
    expect(ob(root).out).toBe('backlog/ already exists (my-app): nothing changed.\n');
  });

  it('says how to turn it on when it makes a backlog in git, and needs git for --hook', () => {
    const root = tmp();
    git(root, 'init', '-q');
    expect(ob(root).out).toMatch(/\nTo check the backlog before every commit: ob init --hook\n$/);
    const loose = tmp();
    expect(ob(loose).out).not.toContain('--hook');
    expect(ob(tmp(), '--hook')).toMatchObject({ code: 1, err: 'ob: --hook needs a git repository: run git init first\n' });
  });

  it('leaves a pre-commit hook of your own alone, before writing anything, and follows core.hooksPath', () => {
    const root = tmp();
    git(root, 'init', '-q');
    mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nnpm run lint\n');
    const r = ob(root, '--hook');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/pre-commit is already a pre-commit hook; to check the backlog too, add this line to it: ob validate \|\| exit 1\n$/);
    expect(existsSync(join(root, 'backlog'))).toBe(false);
    expect(readFileSync(join(root, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe('#!/bin/sh\nnpm run lint\n');

    git(root, 'config', 'core.hooksPath', '.githooks');
    expect(ob(root, '--hook').out).toContain('Installed the pre-commit hook .githooks/pre-commit');
    expect(existsSync(join(root, '.githooks', 'pre-commit'))).toBe(true);
  });
});
