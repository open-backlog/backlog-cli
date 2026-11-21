/** What reading a backlog gives (2.2.2). */

export type ItemType = 'capability' | 'epic' | 'feature' | 'story' | 'bug' | 'spike' | 'task';
export type Status = 'todo' | 'doing' | 'done';

/** The four folders items live in. */
export type ItemFolder = 'capabilities' | 'epics' | 'features' | 'stories';

export interface Item {
  /** `id` from the front matter, as text; falls back to the file name's ID when missing. */
  id: string;
  /** `type` as written (validation checks it is one of the seven). */
  type: string;
  title: string;
  parent?: string;
  /** Every front-matter field, in file order, unknown ones included. */
  fields: Record<string, unknown>;
  /** Everything after the front matter. */
  body: string;
  /** The file, from the backlog folder: `stories/done/2026-11/1.1.1-cart-api.md`. */
  path: string;
  /** The ID and slug the file name gives (null if the name has none). */
  file: { id: string; slug: string } | null;
  folder: ItemFolder;
  /** A story-level item's status, from its folder; undefined if it is not in one. */
  status?: Status;
}

export interface Sprint {
  /** The file name without `.md`: `2026-S24`. */
  name: string;
  fields: Record<string, unknown>;
  body: string;
  path: string;
}

export interface Person {
  name?: string;
  forge?: string;
  [key: string]: unknown;
}

export interface Config {
  spec?: string;
  name?: string;
  estimate?: string;
  'done-folders'?: string;
  repos?: Record<string, string>;
  backlogs?: Record<string, string>;
  [key: string]: unknown;
}

/** A file that could not be read as the spec expects, and why. The rest of the backlog still loads. */
export interface FileError {
  path: string;
  message: string;
}

export interface Backlog {
  /** The backlog folder, absolute: `/work/shop/backlog`. */
  dir: string;
  config: Config;
  /** Every item, ordered by ID. */
  items: Item[];
  sprints: Sprint[];
  /** people.yml, by handle (empty if there is none). */
  people: Record<string, Person>;
  /** Files skipped because they could not be parsed. */
  errors: FileError[];
}

/** A problem that stops a backlog from loading at all: no config.yml, or one that can't be read. */
export class BacklogError extends Error {
  constructor(message: string, readonly path?: string) {
    super(message);
    this.name = 'BacklogError';
  }
}
