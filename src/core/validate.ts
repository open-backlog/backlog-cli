import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';

import { isStoryLevel } from './hierarchy.js';
import { loadBacklog, statusOf } from './read.js';
import { RULE, type Severity } from './rules.js';
import type { Backlog, Item } from './types.js';
import { BacklogError } from './types.js';

/**
 * Validation (2.2.5): every rule a backlog can break, as problems with a stable code, the file,
 * what is wrong and how to fix it. Single-file rules use the spec's own JSON Schema (schema/,
 * copied from backlog-spec), so ob agrees with any tool that uses it; the rules that span files
 * are checked here.
 */
export interface Problem {
  code: string;
  rule: string;
  severity: Severity;
  /** The file, from the backlog folder: `stories/todo/1.1.1-sign-up.md`, `config.yml`. */
  path: string;
  /** The field or part of the file, when there is one. */
  field?: string;
  message: string;
  fix: string;
}

/** One problem as a line: `stories/todo/1.1.2-x.md: OB001 [parent] … Fix: …`. */
export function formatProblem(p: Problem): string {
  return `${p.path}: ${p.code} [${p.rule}] ${p.severity === 'warning' ? 'warning: ' : ''}${p.message}. Fix: ${p.fix}.`;
}

const HANDLE = /^[a-z0-9][a-z0-9._-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PARENT_TYPE: Record<string, string> = { story: 'feature', bug: 'feature', spike: 'feature', task: 'feature', feature: 'epic', epic: 'capability' };
const FOLDER: Record<string, string> = { capability: 'capabilities', epic: 'epics', feature: 'features' };

let schemas: { item: ValidateFunction; config: ValidateFunction } | undefined;

/** The spec's JSON Schema, compiled once (schema/0.1/, beside src/ and dist/ in the package). */
function schema(): { item: ValidateFunction; config: ValidateFunction } {
  if (!schemas) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const load = (name: string) => JSON.parse(readFileSync(new URL(`../../schema/0.1/${name}.schema.json`, import.meta.url), 'utf8'));
    schemas = { item: ajv.compile(load('item')), config: ajv.compile(load('config')) };
  }
  return schemas;
}

/** Loads the backlog in `dir` and validates it; a config.yml it can't load is a [config] problem. */
export function validateDir(dir: string): { backlog: Backlog | null; problems: Problem[] } {
  try {
    const backlog = loadBacklog(dir);
    return { backlog, problems: validate(backlog) };
  } catch (e) {
    if (!(e instanceof BacklogError)) throw e;
    return { backlog: null, problems: [problem('config', 'config.yml', e.message.replace(/^.*?config\.yml: /, 'config.yml '))] };
  }
}

/** Every problem in a loaded backlog, ordered by file, then code. */
export function validate(b: Backlog): Problem[] {
  const out: Problem[] = [];
  const add = (p: Problem) => {
    if (!out.some(q => q.code === p.code && q.path === p.path && q.field === p.field && q.message === p.message)) out.push(p);
  };

  // Files the reader couldn't parse.
  for (const e of b.errors) {
    const rule = e.path.startsWith('sprints/') ? 'sprints' : e.path === 'people.yml' ? 'people' : 'front-matter';
    add(problem(rule, e.path, e.message));
  }

  // config.yml, against the schema.
  if (!schema().config(b.config)) {
    for (const err of schema().config.errors ?? []) {
      const field = fieldOf(err);
      add(problem('config', 'config.yml', err.keyword === 'required' ? `needs "${field}"` : `"${field}" ${describe(err)}`, field));
    }
  }

  const ids = new Map<string, Item[]>();
  for (const item of b.items) ids.set(item.id, [...(ids.get(item.id) ?? []), item]);
  const repos = new Set(Object.keys(b.config.repos ?? {}));
  const sprintNames = new Set(b.sprints.map(s => s.name));

  for (const item of b.items) {
    for (const p of schemaProblems(item)) add(p);
    for (const p of fileProblems(item)) add(p);

    // [parent-exists] and the parent's type ([parent]), across files.
    const parent = item.parent;
    if (parent !== undefined && PARENT_TYPE[item.type] !== undefined) {
      const found = ids.get(parent)?.[0];
      if (!found) add(problem('parent-exists', item.path, `parent ${parent} is not the id of any item in this backlog`, 'parent'));
      // Only when the schema found nothing wrong with this parent, so a file gets one [parent] problem.
      else if (found.type !== PARENT_TYPE[item.type] && !out.some(q => q.path === item.path && q.rule === 'parent')) {
        add(problem('parent', item.path, `${a(item.type)}'s parent must be ${a(PARENT_TYPE[item.type] ?? '')}, but ${parent} is ${a(found.type)}`, 'parent'));
      }
    }

    // [id-unique]
    const same = ids.get(item.id) ?? [];
    if (same.length > 1) {
      add(problem('id-unique', item.path, `id ${item.id} is also used by ${same.filter(o => o !== item).map(o => o.path).join(', ')}`, 'id'));
    }

    // [repo-listed]
    const repo = item.fields['repo'];
    for (const name of Array.isArray(repo) ? repo : repo === undefined ? [] : [repo]) {
      if (typeof name === 'string' && !repos.has(name)) {
        add(problem('repo-listed', item.path, `repo ${name} is not a key of repos: in config.yml`, 'repo'));
      }
    }

    // [sprints]: the sprint an item names has a file.
    const sprint = item.fields['sprint'];
    if (typeof sprint === 'string' && !sprintNames.has(sprint)) {
      add(problem('sprints', item.path, `sprint ${sprint} has no file sprints/${sprint}.md`, 'sprint'));
    }
  }

  // Sprint files: dates, and no list of their items.
  for (const s of b.sprints) {
    const { start, end } = s.fields as { start?: unknown; end?: unknown };
    for (const [k, v] of [['start', start], ['end', end]] as const) {
      if (typeof v !== 'string' || !DATE.test(v)) add(problem('sprints', s.path, v === undefined ? `needs ${k}` : `${k} must be a date, YYYY-MM-DD`, k));
    }
    if (typeof start === 'string' && typeof end === 'string' && DATE.test(start) && DATE.test(end) && end < start) {
      add(problem('sprints', s.path, `ends (${end}) before it starts (${start})`, 'end'));
    }
    for (const [k, v] of Object.entries(s.fields)) {
      if (['items', 'stories', 'children'].includes(k) || (Array.isArray(v) && v.some(x => typeof x === 'string' && b.items.some(i => i.id === x)))) {
        add(problem('not-stored', s.path, `"${k}" lists the sprint's items; items name their sprint instead`, k));
      }
    }
  }

  // people.yml
  for (const [handle, person] of Object.entries(b.people)) {
    if (!HANDLE.test(handle)) add(problem('people', 'people.yml', `"${handle}" is not a handle`, handle));
    const name = person && typeof person === 'object' ? (person as { name?: unknown }).name : undefined;
    if (typeof name !== 'string' || !name.trim()) add(problem('people', 'people.yml', `${handle} has no name`, handle));
    if (EMAIL.test(JSON.stringify(person))) add(problem('no-email', 'people.yml', `${handle} holds an email address`, handle));
  }

  // [local-clones]: each listed backlog is a folder beside this repository.
  const besideRepo = dirname(dirname(b.dir));
  for (const name of Object.keys(b.config.backlogs ?? {})) {
    if (!existsSync(join(besideRepo, name, 'backlog', 'config.yml'))) {
      add(problem('local-clones', 'config.yml', `backlog ${name} has no local clone at ../${name}/backlog/; its items are left out`, 'backlogs'));
    }
  }

  return out.sort((a, c) => (a.path < c.path ? -1 : a.path > c.path ? 1 : a.code < c.code ? -1 : a.code > c.code ? 1 : 0));
}

/** The rules one item's front matter can break, from the spec's JSON Schema. */
function schemaProblems(item: Item): Problem[] {
  const validate = schema().item;
  if (validate(item.fields)) return [];
  const out: Problem[] = [];
  for (const e of validate.errors ?? []) {
    if (e.keyword === 'if') continue; // a summary that repeats the real error
    const field = fieldOf(e);
    const at = (rule: string, message: string) => out.push(problem(rule, item.path, message, field));
    if (['children', 'status', 'progress'].includes(field)) at('not-stored', `"${field}" is stored, but it is worked out`);
    else if (e.schemaPath.startsWith('#/additionalProperties')) at('no-email', `"${field}" holds an email address`);
    else if (field === 'parent') {
      if (e.keyword === 'required') at('parent', `${a(item.type)} needs a parent`);
      else if (e.keyword === 'false schema' || e.keyword === 'not') at('parent', `${a(item.type)} has no parent`);
      else at('parent', `${a(item.type)}'s parent must be ${PARENT_TYPE[item.type] === 'feature' ? 'a feature, such as 2.3' : PARENT_TYPE[item.type] === 'epic' ? 'an epic, such as 2' : 'a capability, such as C1'}`);
    } else if (field === 'id' && e.keyword === 'pattern') at('id-form', `id ${item.id} is not the form ${a(item.type)} needs`);
    else if (e.keyword === 'required') at('fields', `needs "${field}"`);
    else at('fields', `"${field}" ${describe(e)}`);
  }
  return out;
}

/** The rules one item's file name, folder and body can break. */
function fileProblems(item: Item): Problem[] {
  const out: Problem[] = [];
  const name = item.path.slice(item.path.lastIndexOf('/') + 1);

  // [filename]
  if (!item.file) out.push(problem('filename', item.path, `"${name}" is not <id>-<slug>.md`, 'filename'));
  else {
    if (item.file.id !== item.id) out.push(problem('filename', item.path, `the file is named for ${item.file.id}, but its id is ${item.id}`, 'filename'));
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(item.file.slug)) out.push(problem('filename', item.path, `the slug "${item.file.slug}" must be lowercase letters and digits joined by single dashes`, 'filename'));
  }

  // [item-folder]
  const folder = FOLDER[item.type];
  if (folder !== undefined && item.path !== `${folder}/${name}`) out.push(problem('item-folder', item.path, `${a(item.type)} belongs directly in ${folder}/`, 'folder'));
  if (isStoryLevel(item) && !statusOf(item.path)) out.push(problem('item-folder', item.path, `${a(item.type)} belongs directly in stories/todo/ or stories/doing/, or under stories/done/`, 'folder'));

  // [epic-zero]
  if (item.type === 'feature' && item.id.startsWith('0.') && item.file && !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.file.slug)) {
    out.push(problem('epic-zero', item.path, `feature ${item.id} is in epic 0, so its slug must be its month, YYYY-MM, not "${item.file.slug}"`, 'filename'));
  }

  // [comment-line] and [no-email] under ## Comments
  const comments = item.body.split(/^## Comments[ \t]*$/m)[1]?.split(/^## /m)[0] ?? '';
  for (const line of comments.split(/\r?\n/).filter(l => l.startsWith('- '))) {
    if (!/^- \d{4}-\d{2}-\d{2} @[a-z0-9][a-z0-9._-]*: /.test(line)) {
      out.push(problem('comment-line', item.path, `the comment "${line.slice(0, 40)}" does not start with - YYYY-MM-DD @handle:`, 'comments'));
    }
    if (EMAIL.test(line)) out.push(problem('no-email', item.path, 'a comment holds an email address', 'comments'));
  }
  return out;
}

/** "a story", "an epic". */
function a(word: string): string {
  return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;
}

function problem(rule: string, path: string, message: string, field?: string): Problem {
  const r = RULE[rule];
  if (!r) throw new Error(`no rule ${rule}`);
  const p: Problem = { code: r.code, rule, severity: r.severity, path, message, fix: r.fix };
  if (field !== undefined) p.field = field;
  return p;
}

function fieldOf(e: ErrorObject): string {
  return e.instancePath.replace(/^\//, '').split('/')[0] || (e.params as { missingProperty?: string }).missingProperty || '';
}

function describe(e: ErrorObject): string {
  const p = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case 'type': return `must be ${String(p['type'])}`;
    case 'enum': return `must be one of ${(p['allowedValues'] as unknown[]).join(', ')}`;
    case 'const': return `must be ${String(p['allowedValue'])}`;
    case 'minimum': return `must be ${String(p['limit'])} or more`;
    case 'pattern': return 'is not in the right form';
    case 'minItems': case 'minLength': return 'must not be empty';
    case 'oneOf': return 'must be a name or a list of names';
    default: return e.message ?? 'is not valid';
  }
}
