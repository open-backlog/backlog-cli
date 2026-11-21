// After `npm run build`: the package as a user gets it. Packs it, installs the tarball globally
// into a temporary prefix (npm i -g, without touching your real global packages), runs
// `ob --version`, and imports 'open-backlog' by name to check the library entry loads without
// the CLI.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'ob-smoke-'));
const fail = msg => { console.error(`smoke: FAILED — ${msg}`); process.exitCode = 1; };
try {
  const tgz = execFileSync('npm', ['pack', '--silent', '--pack-destination', tmp], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop();
  execFileSync('npm', ['install', '--global', '--prefix', tmp, '--silent', join(tmp, tgz)], { stdio: 'inherit' });

  const version = execFileSync(join(tmp, 'bin', 'ob'), ['--version'], { encoding: 'utf8' }).trim();
  if (version !== pkg.version) fail(`ob --version printed "${version}", expected "${pkg.version}"`);
  else console.log(`smoke: npm i -g gives ob --version ${version}`);

  const installed = join(tmp, 'lib', 'node_modules', pkg.name);
  const lib = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(pkg.name)}); console.log(m.SPEC_VERSION)`], { cwd: installed, encoding: 'utf8' }).trim();
  if (!/^\d+\.\d+$/.test(lib)) fail(`import('${pkg.name}') gave SPEC_VERSION "${lib}"`);
  else console.log(`smoke: import('${pkg.name}') loads the core (spec ${lib})`);

  for (const f of readdirSync(join(installed, 'dist', 'core'))) {
    if (f.endsWith('.js') && /from\s+["'][^"']*\/cli\//.test(readFileSync(join(installed, 'dist', 'core', f), 'utf8'))) fail(`dist/core/${f} imports the CLI`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
