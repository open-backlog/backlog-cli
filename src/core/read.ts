import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { compareIds, parseFileName } from './ids.js';
import type { Backlog, Config, FileError, Item, ItemFolder, Person, Sprint, Status } from './types.js';
import { BacklogError } from './types.js';
import { parseMapping, splitFrontMatter } from './yaml.js';

const ITEM_FOLDERS: ItemFolder[] = ['capabilities', 'epics', 'features', 'stories'];
const STATUSES: Status[] = ['todo', 'doing', 'done'];

/**
 * The backlog folder for a working directory: walks up from `from` to the first folder that
 * holds `backlog/config.yml`, so ob works from anywhere in the repository, inside backlog/
 * included. Throws a BacklogError when there is none.
 */
export function findBacklog(from: string = process.cwd()): string {
  const start = resolve(from);
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'backlog', 'config.yml'))) return join(dir, 'backlog');
    if (dirname(dir) === dir) break;
  }
  throw new BacklogError(`no backlog here: no backlog/config.yml in ${start} or any folder above it`);
}

/**
 * Loads the backlog in `dir` (a folder holding config.yml): the config, every item with its
 * status, the sprints and people.yml. A missing or unreadable config.yml throws a BacklogError
 * naming it; any other file that can't be parsed is listed in `errors` and skipped, so one bad
 * file never hides the rest.
 */
export function loadBacklog(dir: string): Backlog {
  const root = resolve(dir);
  const configPath = join(root, 'config.yml');
  if (!existsSync(configPath)) throw new BacklogError(`${configPath}: not found; a backlog needs a config.yml`, configPath);
  let config: Config | null;
  try {
    config = parseMapping(readFileSync(configPath, 'utf8')) as Config | null;
  } catch (e) {
    throw new BacklogError(`${configPath}: not valid YAML: ${firstLine(e)}`, configPath);
  }
  if (config === null) throw new BacklogError(`${configPath}: must be a YAML mapping, such as "spec: 0.1" and "name: my-app"`, configPath);

  const errors: FileError[] = [];
  const items: Item[] = [];
  for (const folder of ITEM_FOLDERS) {
    for (const path of markdownFiles(root, folder)) {
      const item = readItem(root, path, folder, errors);
      if (item) items.push(item);
    }
  }
  items.sort((a, b) => compareIds(a.id, b.id) || (a.path < b.path ? -1 : 1));

  const sprints: Sprint[] = [];
  for (const path of markdownFiles(root, 'sprints')) {
    const read = readFrontMatter(root, path, errors);
    if (read) sprints.push({ name: baseName(path).replace(/\.md$/, ''), path, ...read });
  }
  sprints.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return { dir: root, config, items, sprints, people: readPeople(root, errors), errors };
}

/** findBacklog, then loadBacklog. */
export function readBacklog(from: string = process.cwd()): Backlog {
  return loadBacklog(findBacklog(from));
}

/** The status a story-level item's folder gives: directly in todo/ or doing/, anywhere under done/. */
export function statusOf(path: string): Status | undefined {
  const parts = path.split('/');
  if (parts[0] !== 'stories' || !STATUSES.includes(parts[1] as Status)) return undefined;
  if (parts[1] === 'done') return 'done';
  return parts.length === 3 ? (parts[1] as Status) : undefined;
}

function readItem(root: string, path: string, folder: ItemFolder, errors: FileError[]): Item | null {
  const read = readFrontMatter(root, path, errors);
  if (!read) return null;
  const { fields, body } = read;
  const file = parseFileName(baseName(path));
  const text = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
  const item: Item = {
    id: text(fields['id']) ?? file?.id ?? '',
    type: text(fields['type']) ?? '',
    title: text(fields['title']) ?? '',
    fields,
    body,
    path,
    file,
    folder,
  };
  const parent = text(fields['parent']);
  if (parent !== undefined) item.parent = parent;
  const status = statusOf(path);
  if (status) item.status = status;
  return item;
}

/** A Markdown file's front matter (as a mapping) and body, or null after noting why in `errors`. */
function readFrontMatter(root: string, path: string, errors: FileError[]): { fields: Record<string, unknown>; body: string } | null {
  const text = readFileSync(join(root, path), 'utf8');
  const split = splitFrontMatter(text);
  if (!split) {
    errors.push({ path, message: 'has no front matter: it must start with a "---" line, the fields, and another "---"' });
    return null;
  }
  try {
    const fields = parseMapping(split.front);
    if (fields === null) {
      errors.push({ path, message: 'front matter is not a YAML mapping of fields' });
      return null;
    }
    return { fields, body: split.body };
  } catch (e) {
    errors.push({ path, message: `front matter is not valid YAML: ${firstLine(e)}` });
    return null;
  }
}

function readPeople(root: string, errors: FileError[]): Record<string, Person> {
  const path = 'people.yml';
  if (!existsSync(join(root, path))) return {};
  try {
    const people = parseMapping(readFileSync(join(root, path), 'utf8'));
    if (people !== null) return people as Record<string, Person>;
    errors.push({ path, message: 'is not a YAML mapping of handles' });
  } catch (e) {
    errors.push({ path, message: `is not valid YAML: ${firstLine(e)}` });
  }
  return {};
}

/** Every .md file under `root/folder`, at any depth, as a path from root with "/" separators. */
function markdownFiles(root: string, folder: string): string[] {
  const base = join(root, folder);
  if (!existsSync(base) || !statSync(base).isDirectory()) return [];
  return (readdirSync(base, { recursive: true }) as string[])
    .filter(f => f.endsWith('.md') && statSync(join(base, f)).isFile())
    .map(f => `${folder}/${f.split(sep).join('/')}`)
    .sort();
}

function firstLine(e: unknown): string {
  return String(e instanceof Error ? e.message : e).split('\n')[0] ?? '';
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
