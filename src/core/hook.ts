import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { repoRoot } from './git.js';
import { BacklogError } from './types.js';

/**
 * The pre-commit hook (3.1.2, ob init --hook): before each commit, ob validate; a commit that
 * breaks the backlog is refused. It uses ob when it's installed, else the same version line from
 * npm with npx, so it works on a clone where ob isn't installed. Hooks aren't shared by git, so
 * each clone installs its own.
 */
export function hookText(version: string): string {
  const line = version.split('.').slice(0, 2).join('.');
  return `#!/bin/sh
# Written by ob init --hook: check the backlog before each commit (ob validate). A commit that
# breaks it is refused; fix what ob validate names, then commit again.
if command -v ob >/dev/null 2>&1; then exec ob validate; fi
exec npx --yes -p open-backlog@${line} ob validate
`;
}

export interface Hook {
  /** The hook file, absolute. */
  path: string;
  /** false: a hook was already there and runs ob validate. */
  written: boolean;
}

/** Where git runs this repository's pre-commit hook (core.hooksPath respected). */
export function hookPath(from: string): string {
  const root = repoRoot(from);
  if (!root) throw new BacklogError('--hook needs a git repository: run git init first');
  const p = execFileSync('git', ['rev-parse', '--git-path', 'hooks/pre-commit'], { cwd: root, encoding: 'utf8' }).trim();
  return isAbsolute(p) ? p : join(root, p);
}

/**
 * Checks that the hook can be installed (call before writing anything else): an existing
 * pre-commit hook that doesn't run ob validate is left alone, with what to add to it.
 */
export function planHook(from: string): Hook {
  const path = hookPath(from);
  if (!existsSync(path)) return { path, written: true };
  if (/\bob validate\b/.test(readFileSync(path, 'utf8'))) return { path, written: false };
  throw new BacklogError(`${path} is already a pre-commit hook; to check the backlog too, add this line to it: ob validate || exit 1`);
}

export function installHook(from: string, version: string): Hook {
  const plan = planHook(from);
  if (plan.written) {
    mkdirSync(join(plan.path, '..'), { recursive: true });
    writeFileSync(plan.path, hookText(version), { flag: 'wx' });
    chmodSync(plan.path, 0o755);
  }
  return plan;
}
