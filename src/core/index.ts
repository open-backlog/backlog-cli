/**
 * open-backlog: the core library (D1). It reads, parses and validates an Open Backlog and
 * assigns IDs; the ob command (src/cli/) and the board (open-backlog-board) are both built on
 * it, so they can't disagree about the rules. It never imports the CLI.
 *
 *   import { readBacklog } from 'open-backlog';
 *   const backlog = readBacklog();          // from the working directory, walking up
 *   updateItem(backlog.dir, item, { assignee: 'ana' });   // one value changes, nothing else
 *
 * Git and the next ID (2.2.6) are added next.
 */

/** The version of the Open Backlog specification this library implements. */
export const SPEC_VERSION = '0.1';

/** Where that specification is published. */
export const SPEC_URL = 'https://openbacklog.org/spec';

export { buildOrder, buildTree, columnOrder, isStoryLevel, progressOf, STORY_LEVEL_TYPES, walk } from './hierarchy.js';
export type { Node, Progress, Tree } from './hierarchy.js';
export { compareIds, parseFileName } from './ids.js';
export { findBacklog, loadBacklog, readBacklog, statusOf } from './read.js';
export { BacklogError } from './types.js';
export { RULE, RULES } from './rules.js';
export type { Rule, Severity } from './rules.js';
export { formatProblem, validate, validateDir } from './validate.js';
export type { Problem } from './validate.js';
export { createItem, folderFor, formatValue, newItemPath, newItemText, setFields, slugify, updateItem } from './write.js';
export type { FieldValue, NewItem } from './write.js';
export type { Backlog, Config, FileError, Item, ItemFolder, ItemType, Person, Sprint, Status } from './types.js';
