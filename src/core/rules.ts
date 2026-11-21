/**
 * Every rule a backlog can break (spec 0.1), each with a stable code. The codes never change
 * meaning: a new rule takes the next free number, and a retired one is never reused. The order
 * is the order the rules appear in the spec.
 *
 * Tool rules that describe how a program behaves ([read-as-text], [keep-unknown]) aren't checked
 * on a backlog; [id-numbers] needs git history (2.2.6). [local-clones] gives a warning.
 */
export type Severity = 'error' | 'warning';

export interface Rule {
  code: string;
  rule: string;
  severity: Severity;
  /** How to fix it, said once for the rule; a problem may say more. */
  fix: string;
}

const r = (code: string, rule: string, fix: string, severity: Severity = 'error'): Rule => ({ code, rule, severity, fix });

export const RULES: Rule[] = [
  r('OB001', 'parent', 'give a story, bug, spike or task a feature as its parent, a feature an epic, an epic a capability or none, and a capability none'),
  r('OB002', 'parent-exists', 'set parent to the id of an item in this backlog, or add that item'),
  r('OB003', 'id-form', 'write the id as its type needs: epic 2, feature 2.3, story 2.3.4, capability C1, whole numbers from 1 with no leading zeros'),
  r('OB004', 'id-unique', 'give the item added later the next free number under its parent, and rename its file to match'),
  r('OB005', 'epic-zero', 'name a feature in epic 0 for its month: slug YYYY-MM, such as 0.1-2026-11.md'),
  r('OB006', 'filename', 'name the file <id>-<slug>.md, with the id as in its front matter and a slug of lowercase letters and digits joined by dashes'),
  r('OB007', 'front-matter', 'start the file with a "---" line, the fields as YAML (key: value), and a closing "---" line'),
  r('OB008', 'fields', 'give every item id, type (capability, epic, feature, story, bug, spike or task) and a one-line title, and each field the format the spec gives'),
  r('OB009', 'repo-listed', 'add the repository under repos: in config.yml, or correct the name in repo'),
  r('OB010', 'not-stored', 'remove the field: children, status and progress are worked out, and a sprint never lists its items'),
  r('OB011', 'no-email', 'replace the email address with a handle, such as jo-smith'),
  r('OB012', 'comment-line', 'start each comment with "- YYYY-MM-DD @handle: "'),
  r('OB013', 'sprints', 'add the sprint file in sprints/, with start and end dates (YYYY-MM-DD) and end not before start'),
  r('OB014', 'people', 'key people.yml by handle (lowercase letters, digits, - _ .), each with a name'),
  r('OB015', 'item-folder', 'move capabilities, epics and features into capabilities/, epics/ and features/, and stories, bugs, spikes and tasks directly into stories/todo/ or stories/doing/, or anywhere under stories/done/'),
  r('OB016', 'config', 'give config.yml spec (such as 0.1) and name (lowercase letters, digits and dashes), and each other key the format the spec gives'),
  r('OB017', 'local-clones', 'clone the backlog beside this repository, in a folder named for its key, to include its items', 'warning'),
];

export const RULE = Object.fromEntries(RULES.map(x => [x.rule, x])) as Record<string, Rule>;
