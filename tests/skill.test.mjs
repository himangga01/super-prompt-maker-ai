// The agent skill (skills/super-prompt-maker): its brief script, SKILL.md and the installer.
// Real Claude/Codex runs of the skill live in tests/cli.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TARGETS } from '../lib/catalog.mjs';
import { buildMetaPrompt, normalizeRequest } from '../lib/engine.mjs';
import { ROOT } from './helpers.mjs';

const SKILL = join(ROOT, 'skills', 'super-prompt-maker');
const SPM = join(SKILL, 'scripts', 'spm.mjs');
const INSTALL = join(ROOT, 'scripts', 'install-skill.mjs');

const node = (args, env) => spawnSync(process.execPath, args, { encoding: 'utf8', env: env ?? process.env });
const spm = (...args) => node([SPM, ...args]);

test('skill brief: same guides and rules as the service, but points at the conversation and asks for Markdown', () => {
  const one = spm('brief', '--target', 'claude');
  assert.equal(one.status, 0, one.stderr);
  assert.ok(one.stdout.includes(TARGETS.find((t) => t.id === 'claude').guide));
  assert.match(one.stdout, /Write these 3 prompts/);
  assert.match(one.stdout, /variant="간결 실행형 \(quick\)"/);
  assert.match(one.stdout, /in your conversation with them/);
  assert.match(one.stdout, /```text/);
  assert.doesNotMatch(one.stdout, /<user_prompt>|Return ONLY valid JSON|do not use tools/);

  const two = spm('brief', '--target', 'ChatGPT,perplexity', '--target', 'chatgpt', '--lang', 'en', '--purpose', 'research');
  assert.equal(two.status, 0, two.stderr);
  assert.match(two.stdout, /Write these 2 prompts/, 'duplicates collapse; ids are case-insensitive');
  assert.match(two.stdout, /Write every prompt in English/);
  assert.match(two.stdout, /Purpose of the enhancement: research/);
  assert.match(two.stdout, /search request, not a persona prompt/);

  assert.match(spm('brief').stdout, /target="universal"/, 'no target means the universal one');
  assert.match(spm('list').stdout, /midjourney/);
});

test('skill brief: bad arguments fail loudly instead of guessing', () => {
  for (const args of [
    ['brief', '--target', 'chatgtp'],
    ['brief', '--target', 'chatgpt,claude,gemini,grok,deepseek'],
    ['brief', '--lang', 'ja'],
    ['brief', '--purpose', 'fun'],
    ['brief', '--target'],
    ['brief', '--input', 'x'],
    ['make'],
  ]) {
    const r = spm(...args);
    assert.equal(r.status, 2, `${args.join(' ')} should fail`);
    assert.match(r.stderr, /Usage:/);
  }
});

test('the web service meta-prompt is unchanged by the skill mode', () => {
  const meta = buildMetaPrompt(normalizeRequest({ input: 'x', targets: ['claude'] }));
  assert.match(meta, /<user_prompt>\nx\n<\/user_prompt>/);
  assert.match(meta, /Return ONLY valid JSON/);
  assert.match(meta, /Write exactly 3 prompts/);
  assert.doesNotMatch(meta, /```text|\(quick\)/);
});

test('SKILL.md: valid frontmatter, and its target table matches the catalog', () => {
  const text = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');
  const front = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  assert.ok(front, 'frontmatter block');
  assert.equal(front.match(/^name: (.+)$/m)?.[1], 'super-prompt-maker', 'name matches the folder name');
  const description = JSON.parse(front.match(/^description: (".*")$/m)?.[1] ?? '""');
  assert.ok(description.length > 50 && description.length <= 1024, `description length ${description.length}`);
  const ids = [...text.matchAll(/^\| `([a-z]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(ids, TARGETS.map((t) => t.id));
});

test('installer: finds each CLI by its settings folder, makes self-contained copies, and never touches a foreign skill', () => {
  const home = mkdtempSync(join(tmpdir(), 'spm-skill-home-'));
  const project = mkdtempSync(join(tmpdir(), 'spm-skill-project-'));
  try {
    const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE_CONFIG_DIR|CODEX_HOME)$/.test(k)));
    const env = { ...base, HOME: home, USERPROFILE: home };
    const run = (...args) => node([INSTALL, ...args], env);
    const dir = (...p) => join(home, ...p, 'skills', 'super-prompt-maker');
    mkdirSync(join(home, '.claude'));
    mkdirSync(join(home, '.codex'));

    const auto = run();
    assert.equal(auto.status, 0, auto.stderr);
    assert.ok(existsSync(join(dir('.claude'), 'SKILL.md')));
    assert.ok(existsSync(join(dir('.agents'), 'lib', 'engine.mjs')), 'Codex reads ~/.agents/skills');
    assert.ok(!existsSync(join(home, '.gemini')), 'no Gemini folder, so Gemini is skipped');
    // The copy runs on its own: from here, ../../../lib is not the repository's lib.
    const brief = node([join(dir('.claude'), 'scripts', 'spm.mjs'), 'brief', '--target', 'gemini']);
    assert.equal(brief.status, 0, brief.stderr);
    assert.match(brief.stdout, /Persona-Task-Context-Format/);

    assert.equal(run('--gemini').status, 0);
    assert.ok(existsSync(join(dir('.gemini'), 'scripts', 'spm.mjs')), 'asked for explicitly, Gemini is installed');

    assert.equal(run('--project', project).status, 0);
    assert.ok(existsSync(join(project, '.claude', 'skills', 'super-prompt-maker', 'SKILL.md')));
    assert.ok(existsSync(join(project, '.agents', 'skills', 'super-prompt-maker', 'SKILL.md')));

    const foreign = join(project, '.agents', 'skills', 'super-prompt-maker', 'SKILL.md');
    writeFileSync(foreign, '---\nname: something-else\n---\n');
    const refused = run('--project', project);
    assert.equal(refused.status, 1);
    assert.equal(readFileSync(foreign, 'utf8'), '---\nname: something-else\n---\n', 'left as it was');
    assert.equal(run('--project', project, '--uninstall').status, 1, 'and never deleted');

    const removed = run('--uninstall');
    assert.equal(removed.status, 0, removed.stderr);
    assert.ok(!existsSync(dir('.claude')) && !existsSync(dir('.agents')));
    assert.equal(run('--bogus').status, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});
