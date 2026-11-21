import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// test/fixtures/ is backlog-spec's examples/, copied by script/sync-spec.sh.
const fixtures = new URL('fixtures/', import.meta.url);
const dirs = (rel: string) => readdirSync(new URL(rel, fixtures), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);

describe("the spec's example backlogs, as fixtures", () => {
  it('has the tiers, the broken backlogs and the tool checks', () => {
    expect(existsSync(new URL('README.md', fixtures))).toBe(true);
    expect(dirs('.').sort()).toEqual(['invalid', 't1-minimal', 't3-application', 't4-portfolio', 'tools']);
    expect(dirs('invalid').length).toBeGreaterThanOrEqual(15);
    expect(dirs('tools').length).toBeGreaterThanOrEqual(3);
  });

  it('has a config.yml in every complete backlog', () => {
    for (const t of ['t1-minimal', 't3-application']) expect(existsSync(new URL(`${t}/backlog/config.yml`, fixtures)), t).toBe(true);
    const portfolio = readdirSync(new URL('t4-portfolio', fixtures), { recursive: true }) as string[];
    expect(portfolio.filter(f => f.endsWith('config.yml')).length).toBeGreaterThanOrEqual(2);
  });
});
