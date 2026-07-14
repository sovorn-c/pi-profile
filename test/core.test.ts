import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  createProfile, validateName, listProfiles, setDefaultProfile, getDefaultProfile,
  deleteProfile, currentProfile, shellHelpers, launchSpec, profileDir, showProfile,
  profileResources, profileDoctor
} from '../src/core.js';

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-profile-test-'));
  fs.mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
  return home;
}

function readJson<T = unknown>(file: string): T { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; }

test('creates profile with template, layout, settings and memory files', () => {
  const home = tempHome();
  const result = createProfile('coder', { home, template: 'coding' });
  assert.equal(result.name, 'coder');
  const dir = path.join(home, '.pi', 'profiles', 'coder');
  assert.equal(result.dir, dir);
  for (const sub of ['skills', 'prompts', 'extensions', 'tools', 'themes', 'sessions', 'memory']) {
    assert.equal(fs.statSync(path.join(dir, sub)).isDirectory(), true);
  }
  assert.deepEqual(readJson(path.join(dir, 'settings.json')), {
    skills: ['skills'], prompts: ['prompts'], extensions: ['extensions'], themes: ['themes'], sessionDir: path.join(dir, 'sessions')
  });
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /focused coding agent/);
  assert.match(fs.readFileSync(path.join(dir, 'memory', 'HINDSIGHT.md'), 'utf8'), /Hindsight/);
});

test('default creation inherits main Pi configuration but starts with fresh identity and state', () => {
  const home = tempHome();
  const agent = path.join(home, '.pi', 'agent');
  const inheritedSettings = {
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet',
    defaultThinkingLevel: 'medium',
    packages: ['npm:example-package'],
    skills: ['skills'],
    extensions: ['extensions'],
    sessionDir: '/tmp/main-pi-sessions'
  };
  fs.writeFileSync(path.join(agent, 'settings.json'), `${JSON.stringify(inheritedSettings)}\n`);
  fs.writeFileSync(path.join(agent, 'keybindings.json'), '{"app.quit":"ctrl+q"}\n');
  for (const [sub, file] of [
    ['extensions', 'main-extension.ts'],
    ['skills', 'main-skill.md'],
    ['prompts', 'review.md'],
    ['themes', 'custom.json'],
    ['tools', 'helper.json'],
    ['bin', 'helper']
  ]) {
    const dir = path.join(agent, sub);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), sub);
  }
  fs.mkdirSync(path.join(agent, 'npm', 'large-package'), { recursive: true });
  fs.writeFileSync(path.join(agent, 'npm', 'large-package', 'marker'), 'package cache');
  fs.writeFileSync(path.join(agent, 'AGENTS.md'), 'main identity');
  fs.writeFileSync(path.join(agent, 'SYSTEM.md'), 'main system prompt');
  fs.writeFileSync(path.join(agent, 'APPEND_SYSTEM.md'), 'main appended prompt');
  fs.writeFileSync(path.join(agent, 'trust.json'), '{"/project":"trusted"}\n');
  fs.mkdirSync(path.join(agent, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(agent, 'sessions', 'old.jsonl'), 'old session');
  fs.mkdirSync(path.join(agent, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(agent, 'memory', 'USER.md'), 'main memory');

  const profile = createProfile('work', { home });
  assert.deepEqual(readJson(path.join(profile.dir, 'settings.json')), {
    ...inheritedSettings,
    sessionDir: path.join(profile.dir, 'sessions')
  });
  assert.deepEqual(readJson(path.join(profile.dir, 'keybindings.json')), { 'app.quit': 'ctrl+q' });
  for (const [sub, file] of [
    ['extensions', 'main-extension.ts'],
    ['skills', 'main-skill.md'],
    ['prompts', 'review.md'],
    ['themes', 'custom.json'],
    ['tools', 'helper.json'],
    ['bin', 'helper']
  ]) {
    assert.equal(fs.readFileSync(path.join(profile.dir, sub, file), 'utf8'), sub);
  }
  assert.equal(fs.existsSync(path.join(profile.dir, 'npm')), false);
  for (const file of ['AGENTS.md', 'SYSTEM.md', 'APPEND_SYSTEM.md', 'trust.json']) {
    assert.equal(fs.existsSync(path.join(profile.dir, file)), false);
  }
  assert.deepEqual(fs.readdirSync(path.join(profile.dir, 'sessions')), []);
  assert.doesNotMatch(fs.readFileSync(path.join(profile.dir, 'memory', 'USER.md'), 'utf8'), /main memory/);

  fs.rmSync(path.join(profile.dir, 'extensions', 'main-extension.ts'));
  assert.equal(fs.existsSync(path.join(agent, 'extensions', 'main-extension.ts')), true);
});

test('materializes linked top-level resources so profile changes stay isolated', () => {
  if (process.platform === 'win32') return;
  const home = tempHome();
  const agent = path.join(home, '.pi', 'agent');
  const sharedExtensions = path.join(home, 'shared-extensions');
  fs.mkdirSync(sharedExtensions);
  fs.writeFileSync(path.join(sharedExtensions, 'shared.ts'), 'shared resource');
  fs.symlinkSync(sharedExtensions, path.join(agent, 'extensions'));

  const profile = createProfile('isolated', { home });
  assert.equal(fs.lstatSync(path.join(profile.dir, 'extensions')).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(profile.dir, 'extensions', 'shared.ts'), 'utf8'), 'shared resource');
  assert.equal(fs.existsSync(path.join(sharedExtensions, 'pi-profile-memory.ts')), false);
  fs.writeFileSync(path.join(profile.dir, 'extensions', 'shared.ts'), 'profile resource');
  assert.equal(fs.readFileSync(path.join(sharedExtensions, 'shared.ts'), 'utf8'), 'shared resource');
});

test('templates replace inherited identity without changing inherited resources', () => {
  const home = tempHome();
  const agent = path.join(home, '.pi', 'agent');
  fs.writeFileSync(path.join(agent, 'AGENTS.md'), 'main identity');
  fs.writeFileSync(path.join(agent, 'SYSTEM.md'), 'main system prompt');
  fs.writeFileSync(path.join(agent, 'APPEND_SYSTEM.md'), 'main append');
  fs.mkdirSync(path.join(agent, 'extensions'), { recursive: true });
  fs.writeFileSync(path.join(agent, 'extensions', 'shared.ts'), 'shared resource');

  const profile = createProfile('coder', { home, template: 'coding' });
  assert.match(fs.readFileSync(path.join(profile.dir, 'AGENTS.md'), 'utf8'), /focused coding agent/);
  assert.doesNotMatch(fs.readFileSync(path.join(profile.dir, 'AGENTS.md'), 'utf8'), /main identity/);
  assert.equal(fs.existsSync(path.join(profile.dir, 'SYSTEM.md')), false);
  assert.match(fs.readFileSync(path.join(profile.dir, 'APPEND_SYSTEM.md'), 'utf8'), /correctness/);
  assert.equal(fs.readFileSync(path.join(profile.dir, 'extensions', 'shared.ts'), 'utf8'), 'shared resource');
});

test('profile clones preserve identity unless an explicit template replaces it', () => {
  const home = tempHome();
  const source = createProfile('source', { home, template: 'coding' });
  fs.writeFileSync(path.join(source.dir, 'AGENTS.md'), 'custom source identity');
  fs.writeFileSync(path.join(source.dir, 'SYSTEM.md'), 'custom source system');
  fs.writeFileSync(path.join(source.dir, 'trust.json'), '{"/project":"trusted"}\n');
  fs.mkdirSync(path.join(source.dir, 'npm', 'large-package'), { recursive: true });
  fs.writeFileSync(path.join(source.dir, 'npm', 'large-package', 'marker'), 'package cache');

  const preserved = createProfile('preserved', { home, from: 'source' });
  assert.equal(fs.readFileSync(path.join(preserved.dir, 'AGENTS.md'), 'utf8'), 'custom source identity');
  assert.equal(fs.readFileSync(path.join(preserved.dir, 'SYSTEM.md'), 'utf8'), 'custom source system');
  assert.equal(readJson<{ template: string }>(path.join(preserved.dir, 'profile.json')).template, 'coding');
  assert.equal(fs.existsSync(path.join(preserved.dir, 'trust.json')), false);
  assert.equal(fs.existsSync(path.join(preserved.dir, 'npm')), false);

  const blank = createProfile('blank-clone', { home, from: 'source', template: 'blank' });
  for (const file of ['AGENTS.md', 'SYSTEM.md', 'APPEND_SYSTEM.md']) {
    assert.equal(fs.existsSync(path.join(blank.dir, file)), false);
  }

  const research = createProfile('research-clone', { home, from: 'source', template: 'research' });
  assert.match(fs.readFileSync(path.join(research.dir, 'AGENTS.md'), 'utf8'), /careful research agent/);
  assert.equal(fs.existsSync(path.join(research.dir, 'SYSTEM.md')), false);
});

test('validates names and rejects traversal/reserved command names', () => {
  for (const good of ['coder', 'research_1', 'x.y-z']) assert.equal(validateName(good), good);
  for (const bad of ['', '../x', 'a/b', 'a\\b', '~me', 'a..b', 'create', 'list', 'bad name']) {
    assert.throws(() => validateName(bad));
  }
});

test('symlinks existing shared auth/models by default', () => {
  const home = tempHome();
  const agent = path.join(home, '.pi', 'agent');
  fs.writeFileSync(path.join(agent, 'auth.json'), '{"token":"x"}\n');
  fs.writeFileSync(path.join(agent, 'models.json'), '{"models":[]}\n');
  const result = createProfile('coder', { home });
  assert.equal(result.auth, 'symlink');
  assert.equal(result.models, 'symlink');
  assert.equal(fs.lstatSync(path.join(result.dir, 'auth.json')).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(path.join(result.dir, 'auth.json')), path.join(agent, 'auth.json'));
});

test('own auth/models create profile-local empty json files', () => {
  const home = tempHome();
  const result = createProfile('coder', { home, ownAuth: true, ownModels: true });
  assert.equal(result.auth, 'own');
  assert.equal(result.models, 'own');
  assert.deepEqual(readJson(path.join(result.dir, 'auth.json')), {});
  assert.deepEqual(readJson(path.join(result.dir, 'models.json')), {});
  assert.equal(fs.lstatSync(path.join(result.dir, 'auth.json')).isSymbolicLink(), false);
});

test('default profile resolution and launch env construction', () => {
  const home = tempHome();
  createProfile('coder', { home });
  setDefaultProfile('coder', { home });
  assert.equal(getDefaultProfile({ home }), 'coder');
  const spec = launchSpec(undefined, ['-p', 'hello'], { home, env: { PATH: '/bin' } });
  assert.equal(spec.command, 'pi');
  assert.deepEqual(spec.args, ['-p', 'hello']);
  assert.equal(spec.env.PI_CODING_AGENT_DIR, path.join(home, '.pi', 'profiles', 'coder'));
  assert.equal(spec.env.PATH, '/bin');
});

test('list, shell helpers, current and dir behavior', () => {
  const home = tempHome();
  createProfile('research', { home });
  createProfile('personal', { home });
  assert.deepEqual(listProfiles({ home }), ['personal', 'research']);
  const shell = shellHelpers({ home });
  assert.match(shell, /pi_personal\(\) \{ pi-profile personal "\$@"; \}/);
  assert.equal(currentProfile({ home, env: {} }), null);
  assert.deepEqual(currentProfile({ home, env: { PI_CODING_AGENT_DIR: path.join(home, '.pi', 'profiles', 'research') } }), {
    name: 'research', dir: path.join(home, '.pi', 'profiles', 'research')
  });
  assert.equal(profileDir('research', home), path.join(home, '.pi', 'profiles', 'research'));
});

test('profiles support blank mode, metadata, and profile-local memory extension', () => {
  const home = tempHome();
  const blank = createProfile('clean', { home, template: 'blank', memory: false });
  assert.equal(blank.memory, false);
  assert.equal(fs.existsSync(path.join(blank.dir, 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(blank.dir, 'memory')), false);
  const coder = createProfile('coder', { home, template: 'coding' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(coder.dir, 'profile.json'), 'utf8')), {
    name: 'coder', label: 'coder', description: 'coding Pi profile', template: 'coding', memory: true, workspace: null
  });
  const extension = fs.readFileSync(path.join(coder.dir, 'extensions', 'pi-profile-memory.ts'), 'utf8');
  assert.match(extension, /agent_settled/);
  assert.match(extension, /profile_memory/);
});

test('clone creates fresh state and clone-all copies memory', () => {
  const home = tempHome();
  const source = createProfile('source', { home });
  fs.appendFileSync(path.join(source.dir, 'memory', 'USER.md'), '\\n- Likes tests.\\n');
  const clone = createProfile('clone', { home, from: 'source' });
  assert.equal(fs.existsSync(path.join(clone.dir, 'sessions')), true);
  assert.doesNotMatch(fs.readFileSync(path.join(clone.dir, 'memory', 'USER.md'), 'utf8'), /Likes tests/);
  const backup = createProfile('backup', { home, from: 'source', cloneAll: true });
  assert.match(fs.readFileSync(path.join(backup.dir, 'memory', 'USER.md'), 'utf8'), /Likes tests/);
  const noMemory = createProfile('stateless', { home, from: 'source', cloneAll: true, memory: false });
  assert.equal(fs.existsSync(path.join(noMemory.dir, 'memory')), false);
  assert.equal(fs.existsSync(path.join(noMemory.dir, 'extensions', 'pi-profile-memory.ts')), false);
  assert.equal(fs.existsSync(path.join(noMemory.dir, 'extensions', 'pi-profile-memory.js')), false);
});

test('creation is atomic when inherited configuration is invalid', () => {
  const home = tempHome();
  const agent = path.join(home, '.pi', 'agent');
  fs.writeFileSync(path.join(agent, 'settings.json'), '{invalid json');
  assert.throws(() => createProfile('broken', { home }), /Invalid settings.json/);
  const profiles = path.join(home, '.pi', 'profiles');
  assert.equal(fs.existsSync(path.join(profiles, 'broken')), false);
  assert.deepEqual(fs.readdirSync(profiles), []);
});

test('validates advanced creation option combinations and workspace paths', () => {
  const home = tempHome();
  assert.throws(() => createProfile('bad-clone', { home, cloneAll: true }), /requires --from/);
  assert.throws(() => createProfile('bad-source', { home, from: 'x', fromBase: true }), /Cannot use both/);
  assert.throws(
    () => createProfile('bad-workspace', { home, workspace: path.join(home, 'missing') }),
    /Workspace does not exist/,
  );
  assert.equal(fs.existsSync(path.join(home, '.pi', 'profiles', 'bad-workspace')), false);
});

test('uses private permissions for profile state on POSIX systems', () => {
  const home = tempHome();
  const profile = createProfile('private', { home, ownAuth: true, ownModels: true });
  if (process.platform === 'win32') return;
  const mode = (target: string) => fs.statSync(target).mode & 0o777;
  assert.equal(mode(profile.dir), 0o700);
  assert.equal(mode(path.join(profile.dir, 'memory')), 0o700);
  assert.equal(mode(path.join(profile.dir, 'auth.json')), 0o600);
  assert.equal(mode(path.join(profile.dir, 'models.json')), 0o600);
  assert.equal(mode(path.join(profile.dir, 'memory', 'USER.md')), 0o600);
});

test('workspace metadata is resolved and used by launch spec', () => {
  const home = tempHome();
  const workspace = path.join(home, 'workspace');
  fs.mkdirSync(workspace);
  createProfile('project', { home, workspace });
  const spec = launchSpec('project', [], { home, env: {} });
  assert.equal(spec.cwd, workspace);
});

test('show profile reports metadata and default state', () => {
  const home = tempHome();
  createProfile('coder', { home, template: 'coding', description: 'Focused coding profile', label: 'Coder' });
  setDefaultProfile('coder', { home });
  assert.deepEqual(showProfile('coder', { home }), {
    name: 'coder', label: 'Coder', description: 'Focused coding profile', template: 'coding', memory: true, workspace: null,
    dir: path.join(home, '.pi', 'profiles', 'coder'), default: true
  });
});

test('delete requires --force and clears default', () => {
  const home = tempHome();
  createProfile('coder', { home });
  setDefaultProfile('coder', { home });
  assert.throws(() => deleteProfile('coder', { home }));
  const result = deleteProfile('coder', { home, force: true });
  assert.deepEqual(result, { deleted: 'coder' });
  assert.equal(fs.existsSync(path.join(home, '.pi', 'profiles', 'coder')), false);
  assert.equal(getDefaultProfile({ home }), null);
});

test('cli rejects missing option values and unknown create arguments', () => {
  const home = tempHome();
  const cli = path.resolve('dist/cli.js');
  let result = spawnSync(process.execPath, [cli, 'create', 'coder', '--template'], {
    cwd: path.resolve('.'), env: { ...process.env, PI_PROFILE_HOME: home }, encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--template requires a value/);
  result = spawnSync(process.execPath, [cli, 'create', '--unknown'], {
    cwd: path.resolve('.'), env: { ...process.env, PI_PROFILE_HOME: home }, encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown create argument/);
});

test('cli emits json and forwards default profile args to pi', () => {
  const home = tempHome();
  const cli = path.resolve('dist/cli.js');
  let r = spawnSync(process.execPath, [cli, 'create', 'coder', '--json'], { cwd: path.resolve('.'), env: { ...process.env, PI_PROFILE_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal((JSON.parse(r.stdout) as { name: string }).name, 'coder');
  r = spawnSync(process.execPath, [cli, 'default', 'coder'], { cwd: path.resolve('.'), env: { ...process.env, PI_PROFILE_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);

  const binDir = path.join(home, 'bin');
  fs.mkdirSync(binDir);
  const capture = path.join(home, 'capture.json');
  fs.writeFileSync(path.join(binDir, 'pi'), `#!/usr/bin/env node\nconst fs=require('fs');fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({args:process.argv.slice(2), dir:process.env.PI_CODING_AGENT_DIR}));\n`, { mode: 0o755 });
  r = spawnSync(process.execPath, [cli, '-p', 'hello'], { cwd: path.resolve('.'), env: { ...process.env, PI_PROFILE_HOME: home, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readJson(capture), { args: ['-p', 'hello'], dir: path.join(home, '.pi', 'profiles', 'coder') });
});

test('profileResources reports declared, missing, and stale packages plus loose resources', () => {
  const home = tempHome();
  const profile = createProfile('coder', { home, memory: false });
  const dir = profile.dir;

  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    skills: ['skills'], prompts: ['prompts'], extensions: ['extensions'], themes: ['themes'],
    sessionDir: 'sessions',
    packages: [
      'npm:declared-npm',
      { source: 'git:github.com/owner/repo' },
      'npm:missing-npm'
    ]
  }, null, 2));

  fs.mkdirSync(path.join(dir, 'npm'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'npm', 'package.json'), JSON.stringify({
    name: 'pi-extensions', private: true,
    dependencies: {
      'declared-npm': '^1.0.0',
      'stale-npm': '^1.0.0'
    }
  }));

  fs.mkdirSync(path.join(dir, 'git', 'github.com', 'owner', 'repo'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'git', 'github.com', 'owner', 'stale'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'extensions', 'loose.ts'), '// loose');
  fs.mkdirSync(path.join(dir, 'extensions', 'declared-npm'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'extensions', 'declared-npm', 'config.json'), '{}');

  const resources = profileResources('coder', { home });
  assert.deepEqual(resources.packages.declared.map((p) => p.source), [
    'npm:declared-npm', 'git:github.com/owner/repo', 'npm:missing-npm'
  ]);
  assert.deepEqual(resources.packages.missing.map((p) => p.source), ['npm:missing-npm']);
  assert.deepEqual(resources.packages.stale.map((p) => p.source), [
    'npm:stale-npm', 'git:github.com/owner/stale'
  ]);
  assert.deepEqual(resources.extensions.loose, ['loose.ts']);
  assert.deepEqual(resources.extensions.configOnly, ['declared-npm']);
});

test('profileDoctor reports invalid settings and package mismatches', () => {
  const home = tempHome();
  const profile = createProfile('coder', { home });
  const dir = profile.dir;

  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    skills: ['skills'], prompts: ['prompts'], extensions: ['extensions'], themes: ['themes'],
    sessionDir: 'sessions',
    packages: ['npm:missing-npm']
  }, null, 2));

  fs.mkdirSync(path.join(dir, 'npm'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'npm', 'package.json'), JSON.stringify({
    name: 'pi-extensions', private: true,
    dependencies: { 'stale-npm': '^1.0.0' }
  }));

  fs.mkdirSync(path.join(dir, 'extensions', 'stale-npm'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'extensions', 'stale-npm', 'config.json'), '{}');

  const diagnosis = profileDoctor('coder', { home });
  assert.equal(diagnosis.ok, false);
  assert.ok(diagnosis.issues.some((i) => i.severity === 'error' && i.message.includes('missing-npm')));
  assert.ok(diagnosis.issues.some((i) => i.severity === 'warning' && i.message.includes('stale-npm')));
  assert.ok(diagnosis.issues.some((i) => i.severity === 'info' && i.message.includes('Configuration-only')));
});

test('cli resources and doctor emit json', () => {
  const home = tempHome();
  const cli = path.resolve('dist/cli.js');
  let r = spawnSync(process.execPath, [cli, 'create', 'coder', '--json'], { cwd: path.resolve('.'), env: { ...process.env, PI_PROFILE_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);

  r = spawnSync(process.execPath, [cli, 'resources', 'coder', '--json'], { cwd: path.resolve('.'), env: { ...process.env, PI_PROFILE_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const resources = JSON.parse(r.stdout) as { name: string; packages: { declared: unknown[] } };
  assert.equal(resources.name, 'coder');
  assert.ok(Array.isArray(resources.packages.declared));

  r = spawnSync(process.execPath, [cli, 'doctor', 'coder', '--json'], { cwd: path.resolve('.'), env: { ...process.env, PI_PROFILE_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const diagnosis = JSON.parse(r.stdout) as { name: string; ok: boolean };
  assert.equal(diagnosis.name, 'coder');
  assert.equal(diagnosis.ok, true);
});

test('cli forwards install remove config subcommands to default profile', () => {
  const home = tempHome();
  const cli = path.resolve('dist/cli.js');
  let r = spawnSync(process.execPath, [cli, 'create', 'coder', '--json'], { cwd: path.resolve('.'), env: { ...process.env, PI_PROFILE_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  r = spawnSync(process.execPath, [cli, 'default', 'coder'], { cwd: path.resolve('.'), env: { ...process.env, PI_PROFILE_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);

  const binDir = path.join(home, 'bin');
  fs.mkdirSync(binDir);
  const capture = path.join(home, 'capture.json');
  fs.writeFileSync(path.join(binDir, 'pi'), `#!/usr/bin/env node\nconst fs=require('fs');fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({args:process.argv.slice(2), dir:process.env.PI_CODING_AGENT_DIR}));\n`, { mode: 0o755 });

  r = spawnSync(process.execPath, [cli, 'install', 'npm:foo'], { cwd: path.resolve('.'), env: { ...process.env, PI_PROFILE_HOME: home, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readJson(capture), { args: ['install', 'npm:foo'], dir: path.join(home, '.pi', 'profiles', 'coder') });

  r = spawnSync(process.execPath, [cli, 'remove', 'npm:foo'], { cwd: path.resolve('.'), env: { ...process.env, PI_PROFILE_HOME: home, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readJson(capture), { args: ['remove', 'npm:foo'], dir: path.join(home, '.pi', 'profiles', 'coder') });
});
