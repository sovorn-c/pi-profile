import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  createProfile, validateName, listProfiles, setDefaultProfile, getDefaultProfile,
  deleteProfile, currentProfile, shellHelpers, launchSpec, profileDir, showProfile
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
    skills: ['skills'], prompts: ['prompts'], extensions: ['extensions'], themes: ['themes'], sessionDir: 'sessions'
  });
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /focused coding agent/);
  assert.match(fs.readFileSync(path.join(dir, 'memory', 'HINDSIGHT.md'), 'utf8'), /Hindsight/);
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
