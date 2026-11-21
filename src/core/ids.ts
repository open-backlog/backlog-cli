/**
 * IDs (spec section 2): epic `2`, feature `2.3`, story-level `2.3.4`, capability `C1`. Always
 * text, never numbers ([read-as-text]): `1.10` is the tenth feature of epic 1, not 1.1.
 */

/** A file name's ID and slug: `2.3.4-ob-move.md` → 2.3.4 and ob-move. Null if it has no ID. */
export function parseFileName(name: string): { id: string; slug: string } | null {
  const m = /^(C\d+|\d+(?:\.\d+)*)-(.+)\.md$/.exec(name);
  return m?.[1] && m[2] ? { id: m[1], slug: m[2] } : null;
}

/**
 * Orders IDs as the spec does: capabilities first, then by each part as a number, so 1.2 comes
 * before 1.10, and a parent before its children.
 */
export function compareIds(a: string, b: string): number {
  const capA = a.startsWith('C'), capB = b.startsWith('C');
  if (capA !== capB) return capA ? -1 : 1;
  const pa = a.replace(/^C/, '').split('.').map(Number), pb = b.replace(/^C/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? -1, y = pb[i] ?? -1;
    if (x !== y) return x - y;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
