// After `npm run build`: the package as a user gets it. Packs it, installs the tarball globally
// into a temporary prefix (npm i -g, without touching your real global packages), runs
// `ob --version`, imports 'open-backlog' by name to check the library entry loads without the
// CLI, and reads a fixture backlog through it.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'ob-smoke-'));
const fail = msg => { console.error(`smoke: FAILED — ${msg}`); process.exitCode = 1; };
try {
  const tgz = execFileSync('npm', ['pack', '--silent', '--pack-destination', tmp], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop();
  // Only what a user needs: the built code and its types, the schema, the README, the licence.
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--silent'], { cwd: root, encoding: 'utf8' }));
  const files = packed.files.map(f => f.path);
  const extra = files.filter(f => !/^(package\.json|README\.md|LICENSE|schema\/\d+\.\d+\/[a-z]+\.schema\.json|dist\/(core|cli)\/[a-z-]+\.(js|d\.ts))$/.test(f));
  const missing = ['package.json', 'README.md', 'LICENSE', 'dist/cli/main.js', 'dist/core/index.js', 'dist/core/index.d.ts', 'schema/0.1/item.schema.json'].filter(f => !files.includes(f));
  if (extra.length || missing.length || pkg.private) fail(`the package has ${extra.join(', ') || 'nothing extra'}, lacks ${missing.join(', ') || 'nothing'}, private: ${pkg.private ?? false}`);
  else console.log(`smoke: the package is ${files.length} files: dist (js and types), schema, README, LICENSE, package.json`);

  execFileSync('npm', ['install', '--global', '--prefix', tmp, '--silent', join(tmp, tgz)], { stdio: 'inherit' });

  const version = execFileSync(join(tmp, 'bin', 'ob'), ['--version'], { encoding: 'utf8' }).trim();
  if (version !== pkg.version) fail(`ob --version printed "${version}", expected "${pkg.version}"`);
  else console.log(`smoke: npm i -g gives ob --version ${version}`);

  const installed = join(tmp, 'lib', 'node_modules', pkg.name);
  const lib = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(pkg.name)}); console.log(m.SPEC_VERSION)`], { cwd: installed, encoding: 'utf8' }).trim();
  if (!/^\d+\.\d+$/.test(lib)) fail(`import('${pkg.name}') gave SPEC_VERSION "${lib}"`);
  else console.log(`smoke: import('${pkg.name}') loads the core (spec ${lib})`);

  // The installed package, with its own dependencies, reads a real backlog from a subfolder.
  const fixture = join(root, 'test', 'fixtures', 't1-minimal', 'backlog', 'stories', 'todo');
  const read = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const { readBacklog } = await import(${JSON.stringify(pkg.name)}); const b = readBacklog(${JSON.stringify(fixture)});
     console.log(b.config.name + ' ' + b.items.map(i => i.id + ':' + (i.status ?? '-')).join(' '))`], { cwd: installed, encoding: 'utf8' }).trim();
  const expected = 'notes 1:- 1.1:- 1.1.1:done 1.1.2:doing 1.1.3:todo';
  if (read !== expected) fail(`readBacklog gave "${read}", expected "${expected}"`);
  else console.log(`smoke: the installed package reads a backlog from a subfolder (${read})`);

  // It validates with the JSON Schema it ships (schema/ in the package).
  const broken = join(root, 'test', 'fixtures', 'invalid', 'parent', 'backlog');
  const codes = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const { validateDir } = await import(${JSON.stringify(pkg.name)});
     console.log([...new Set(validateDir(${JSON.stringify(broken)}).problems.map(p => p.code))].join(' '))`], { cwd: installed, encoding: 'utf8' }).trim();
  if (codes !== 'OB001') fail(`validateDir on invalid/parent gave "${codes}", expected "OB001"`);
  else console.log('smoke: the installed package validates with its schema (invalid/parent → OB001)');

  // The installed ob init makes a backlog that validates, at the top of a code repository, and a
  // second run changes nothing.
  const code = join(tmp, 'code');
  mkdirSync(join(code, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: code });
  const ob = (...args) => execFileSync(join(tmp, 'bin', 'ob'), args, { cwd: join(code, 'src'), encoding: 'utf8' });
  ob('init', '--name', 'smoke');
  const again = ob('init');
  // ob new on it (no commit: CI has no git identity), including a stray bug into epic 0.
  ob('new', 'epic', 'Launch', '--no-commit');
  ob('new', 'feature', 'Sign up', '--parent', '1', '--no-commit');
  const story = ob('new', 'story', 'Form', '--parent', '1.1', '--no-commit');
  const bug = ob('new', 'bug', 'Crash', '--no-commit');
  if (!story.includes('Created 1.1.1 ../backlog/stories/todo/1.1.1-form.md') || !/Created 0\.1\.1 /.test(bug)) fail(`ob new printed "${story.trim()}" and "${bug.trim()}"`);
  else console.log('smoke: the installed ob new adds an epic, feature, story and a stray bug (epic 0)');
  const initCodes = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const { validateDir } = await import(${JSON.stringify(pkg.name)});
     console.log(validateDir(${JSON.stringify(join(code, 'backlog'))}).problems.length)`], { cwd: installed, encoding: 'utf8' }).trim();
  if (initCodes !== '0' || !again.includes('nothing changed')) fail(`ob init gave ${initCodes} problems; second run said "${again.trim()}"`);
  else console.log('smoke: the installed ob init makes a backlog at the repository top, a second run changes nothing, and with the new items it validates');

  // ob validate as a git pre-commit hook: a valid backlog commits, a broken one is refused, and
  // the exit code is what CI needs (0 valid, 1 errors).
  // Installed by ob init --hook, as a user would; the installed ob is on the PATH it runs with.
  const hooked = ob('init', '--hook');
  if (!hooked.includes('Installed the pre-commit hook')) fail(`ob init --hook printed "${hooked.trim()}"`);
  const who = { ...process.env, PATH: `${join(tmp, 'bin')}:${process.env.PATH}`, GIT_AUTHOR_NAME: 'Smoke', GIT_AUTHOR_EMAIL: 'smoke@example.com', GIT_COMMITTER_NAME: 'Smoke', GIT_COMMITTER_EMAIL: 'smoke@example.com' };
  const gitIn = (...args) => spawnSync('git', args, { cwd: code, env: who, encoding: 'utf8' });
  gitIn('add', '-A');
  const good = gitIn('commit', '-qm', 'backlog');
  writeFileSync(join(code, 'backlog', 'stories', 'todo', '1.1.9-lost.md'), '---\nid: 1.1.9\ntype: story\ntitle: Lost\nparent: 9.9\n---\n');
  gitIn('add', '-A');
  const bad = gitIn('commit', '-qm', 'broken');
  if (good.status !== 0 || bad.status === 0 || !(bad.stdout + bad.stderr).includes('OB002')) fail(`pre-commit hook: good commit ${good.status} ${good.stderr}, broken commit ${bad.status} ${bad.stdout}${bad.stderr}`);
  else console.log('smoke: ob init --hook installs the pre-commit hook: a valid backlog commits, a broken one is refused (OB002)');
  const ci = spawnSync(join(tmp, 'bin', 'ob'), ['validate', '--json'], { cwd: code, encoding: 'utf8' });
  if (ci.status !== 1 || JSON.parse(ci.stdout).errors !== 1) fail(`ob validate --json exited ${ci.status}: ${ci.stdout}`);
  else console.log('smoke: ob validate --json exits 1 with the errors, for CI');

  // ob start: a staged git mv (--no-commit), as by hand.
  const started = ob('start', '1.1.1', '--no-commit');
  const staged = gitIn('status', '--porcelain').stdout;
  if (!started.startsWith('Moved 1.1.1 to doing') || !staged.includes('R  backlog/stories/todo/1.1.1-form.md -> backlog/stories/doing/1.1.1-form.md')) fail(`ob start printed "${started.trim()}"; git status: ${staged}`);
  else console.log('smoke: the installed ob start stages a git mv to doing');

  // ob list, piped: plain rows in build order.
  const listed = ob('list').split('\n').filter(Boolean).map(l => l.split(/\s+/).slice(0, 2).join(' '));
  if (listed.join(', ') !== '0.1.1 todo, 1.1.1 doing, 1.1.9 todo') fail(`ob list printed ${JSON.stringify(listed)}`);
  else console.log('smoke: the installed ob list prints the items in build order');

  // ob tree and ob show on it.
  const tree = ob('tree').split('\n')[0];
  const shown = ob('show', '1.1.1').split('\n').slice(0, 2).join(' / ');
  if (!tree.startsWith('0  todo   0/1 done (0%)') || shown !== '1-launch › 1.1-sign-up › 1.1.1-form / ../backlog/stories/doing/1.1.1-form.md  doing') fail(`ob tree "${tree}"; ob show "${shown}"`);
  else console.log('smoke: the installed ob tree and ob show print the plan and an item');

  // ob comment, signed with --as (no git identity in CI): the line, under ## Comments, no commit.
  const commented = ob('comment', '1.1.1', 'Smoke tested', '--as', 'smoke', '--no-commit');
  const storyText = readFileSync(join(code, 'backlog', 'stories', 'doing', '1.1.1-form.md'), 'utf8');
  const day = new Date();
  const today = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  if (!commented.includes(`- ${today} @smoke: Smoke tested`) || !storyText.endsWith(`## Comments\n- ${today} @smoke: Smoke tested\n`)) fail(`ob comment printed "${commented.trim()}"; file ends "${storyText.slice(-80)}"`);
  else console.log('smoke: the installed ob comment adds a signed line under ## Comments');

  // ob serve with a board installed globally beside ob (a stand-in that prints what it was
  // given): ob runs it with node, for this folder, with no npm download. The package itself
  // carries no board.
  const line = pkg.version.split('.').slice(0, 2).join('.');
  const fake = join(tmp, 'lib', 'node_modules', 'open-backlog-board');
  mkdirSync(fake, { recursive: true });
  writeFileSync(join(fake, 'package.json'), JSON.stringify({ name: 'open-backlog-board', version: `${line}.0`, bin: { 'open-backlog-board': 'main.js' } }));
  writeFileSync(join(fake, 'main.js'), 'console.log(JSON.stringify(process.argv.slice(2)))\n');
  const served = spawnSync(join(tmp, 'bin', 'ob'), ['serve', '--port', '4999', '--no-open'], { cwd: join(code, 'src'), encoding: 'utf8' });
  const boardArgs = served.stdout.trim();
  if (served.status !== 0 || boardArgs !== JSON.stringify([realpathSync(join(code, 'src')), '--port', '4999']) || !served.stderr.startsWith(`Starting open-backlog-board ${line}.0`) || pkg.dependencies['open-backlog-board'] || files.some(f => f.includes('board'))) fail(`ob serve exited ${served.status}: ${boardArgs} ${served.stderr}`);
  else console.log(`smoke: ob serve runs the installed open-backlog-board ${line}.0 for this folder; the package carries no board`);

  // A reader that stops early (ob show | head): the pipe is closed before ob writes, and ob
  // stops quietly with exit 0, not a stack trace.
  const early = spawn(join(tmp, 'bin', 'ob'), ['show', '1.1.1'], { cwd: code, stdio: ['ignore', 'pipe', 'pipe'] });
  early.stdout.destroy();
  let earlyErr = '';
  early.stderr.on('data', d => { earlyErr += d; });
  const earlyCode = await new Promise(resolve => early.on('close', resolve));
  if (earlyCode !== 0 || earlyErr) fail(`ob show into a closed pipe exited ${earlyCode}: ${earlyErr.split('\n')[0]}`);
  else console.log('smoke: ob into a pipe that closes early (ob show | head) stops quietly, exit 0');

  for (const f of readdirSync(join(installed, 'dist', 'core'))) {
    if (f.endsWith('.js') && /from\s+["'][^"']*\/cli\//.test(readFileSync(join(installed, 'dist', 'core', f), 'utf8'))) fail(`dist/core/${f} imports the CLI`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
