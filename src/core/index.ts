/**
 * open-backlog: the core library (D1). It reads, parses and validates an Open Backlog and
 * assigns IDs; the ob command (src/cli/) and the board (open-backlog-board) are both built on
 * it, so they can't disagree about the rules. It never imports the CLI.
 *
 *   import { readBacklog } from 'open-backlog';
 *   const backlog = readBacklog();          // from the working directory, walking up
 *   updateItem(backlog.dir, item, { assignee: 'ana' });   // one value changes, nothing else
 *
 * Hierarchy and progress (2.2.4), validation (2.2.5), and git and the next ID
 * (2.2.6) are added here, story by story.
 */

/** The version of the Open Backlog specification this library implements. */
export const SPEC_VERSION = '0.1';

/** Where that specification is published. */
export const SPEC_URL = 'https://openbacklog.org/spec';

export { compareIds, parseFileName } from './ids.js';
export { findBacklog, loadBacklog, readBacklog, statusOf } from './read.js';
export { BacklogError } from './types.js';
export { createItem, folderFor, formatValue, newItemPath, newItemText, setFields, slugify, updateItem } from './write.js';
export type { FieldValue, NewItem } from './write.js';
export type { Backlog, Config, FileError, Item, ItemFolder, ItemType, Person, Sprint, Status } from './types.js';
