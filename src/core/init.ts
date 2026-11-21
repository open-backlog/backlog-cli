import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { repoRoot } from './git.js';
import { SPEC_VERSION } from './spec.js';
import { BacklogError } from './types.js';
import { formatValue, slugify } from './write.js';
import { parseMapping } from './yaml.js';

/**
 * A new backlog (2.3.1): `backlog/` with a two-line config.yml (spec, name) and the folders, each
 * kept in git by a .gitkeep. It never overwrites a file: run again, it finds config.yml and
 * changes nothing.
 */

/** The folders a new backlog starts with; capabilities/ and sprints/ come when they're needed. */
export const INIT_FOLDERS = ['epics', 'features', 'stories/todo', 'stories/doing', 'stories/done'] as const;

/** A backlog name ([config]): lowercase letters and digits, joined by single dashes. */
export const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const INIT_README = `# Backlog

This folder is an [Open Backlog](https://openbacklog.org/spec): every item is a Markdown file,
and git history is its timeline.

- \`config.yml\`: the backlog's name and the spec version it follows.
- \`epics/\`: large goals, such as \`2-build.md\`.
- \`features/\`: parts of an epic, such as \`2.3-cli.md\` (feature 3 of epic 2).
- \`stories/\`: stories, bugs, spikes and tasks, such as \`2.3.4-ob-move.md\`, in a folder for
  their status: \`todo/\`, \`doing/\` or \`done/\`. Moving the file changes its status.

The \`ob\` command creates, moves, lists and checks items: run \`ob --help\`.
`;

export interface InitOptions {
  /** The backlog's name; by default the repository's (or folder's) name, as a slug. */
  name?: string;
  /** Also write backlog/README.md explaining the folders. */
  readme?: boolean;
}

export interface InitResult {
  /** The backlog folder. */
  dir: string;
  name: string;
  /** Paths created, relative to the backlog folder; empty when it already existed. */
  created: string[];
  /** True when config.yml was already there, so nothing was changed. */
  existed: boolean;
}

/**
 * Where `ob init` puts the backlog: `backlog/` at the top of the git repository holding `from`,
 * or in `from` itself outside git.
 */
export function initDir(from: string = process.cwd()): string {
  return join(repoRoot(from) ?? resolve(from), 'backlog');
}

/**
 * Creates the backlog in `dir` (a folder named backlog, usually from initDir). If its config.yml
 * exists, nothing is written. Otherwise each missing file is added and existing ones are kept.
 */
export function initBacklog(dir: string, opts: InitOptions = {}): InitResult {
  const root = resolve(dir);
  if (existsSync(join(root, 'config.yml'))) return { dir: root, name: existingName(root), created: [], existed: true };
  const name = opts.name ?? slugify(basename(resolve(root, '..')));
  if (!NAME_PATTERN.test(name)) {
    throw new BacklogError(opts.name === undefined
      ? `can't make a backlog name from the folder "${basename(resolve(root, '..'))}"; choose one with --name, such as --name my-app`
      : `"${name}" can't be a backlog name: use lowercase letters, digits and dashes, such as my-app`);
  }
  const files: [string, string][] = [
    ['config.yml', `spec: ${formatValue('spec', SPEC_VERSION)}\nname: ${formatValue('name', name)}\n`],
    ...INIT_FOLDERS.map((f): [string, string] => [`${f}/.gitkeep`, '']),
  ];
  if (opts.readme) files.push(['README.md', INIT_README]);
  const created: string[] = [];
  for (const [path, text] of files) {
    const abs = join(root, path);
    if (existsSync(abs)) continue;
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, text, { flag: 'wx' });
    created.push(path);
  }
  return { dir: root, name, created, existed: false };
}

/** The name in an existing config.yml, or "" if it can't be read (ob validate says why). */
function existingName(root: string): string {
  try {
    const name = parseMapping(readFileSync(join(root, 'config.yml'), 'utf8'))?.['name'];
    return typeof name === 'string' ? name : '';
  } catch {
    return '';
  }
}
