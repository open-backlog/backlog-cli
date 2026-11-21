import { parse } from 'yaml';

/** The fields a tool must read as the text written ([read-as-text]). */
export const TEXT_FIELDS = ['id', 'parent', 'sprint', 'release', 'spec', 'name'];

/**
 * Parses a YAML mapping. Every value is read as YAML would, except the TEXT_FIELDS, which keep
 * the text as written (an unquoted 1.10 stays "1.10", not 1.1). Throws on bad YAML; returns
 * null when the YAML is fine but not a mapping.
 */
export function parseMapping(text: string): Record<string, unknown> | null {
  const values: unknown = parse(text);
  if (values === null || values === undefined) return {};
  if (typeof values !== 'object' || Array.isArray(values)) return null;
  // The failsafe schema reads every scalar as its text.
  const asText = parse(text, { schema: 'failsafe' }) as Record<string, unknown>;
  const out = values as Record<string, unknown>;
  for (const key of TEXT_FIELDS) {
    if (key in out && typeof asText[key] === 'string') out[key] = asText[key];
  }
  return out;
}

/** A file's front matter and body: the mapping between the opening and closing `---` lines. */
export function splitFrontMatter(text: string): { front: string; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text);
  return m ? { front: m[1] ?? '', body: m[2] ?? '' } : null;
}
