#!/usr/bin/env node
// Installs the Super Prompt Maker agent skill (skills/super-prompt-maker) for Claude Code, Codex and Gemini CLI.
//
//   node scripts/install-skill.mjs                        every CLI whose settings folder exists on this PC
//   node scripts/install-skill.mjs --claude --codex --gemini
//   node scripts/install-skill.mjs --project <folder>     one project only (.claude/skills and .agents/skills)
//   node scripts/install-skill.mjs --uninstall [same flags]
//
// Where each CLI looks for skills:
//   Claude Code   ~/.claude/skills (CLAUDE_CONFIG_DIR if set)      project: .claude/skills
//   Codex         ~/.agents/skills (Gemini CLI reads it too)       project: .agents/skills
//   Gemini CLI    ~/.gemini/skills (also Antigravity CLI, agy)      project: .agents/skills
// An installed copy is self-contained: lib/catalog.mjs and lib/engine.mjs are copied in next to the script.
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const NAME = 'super-prompt-maker';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'skills', NAME);
const LIB_FILES = ['catalog.mjs', 'engine.mjs'];
const CLIS = ['claude', 'codex', 'gemini'];

function fail(message) {
  console.error(`오류: ${message}`);
  process.exit(1);
}

function parse(argv) {
  const opts = { clis: [], project: null, uninstall: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--uninstall') opts.uninstall = true;
    else if (a === '--project') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail('--project 뒤에 폴더 경로를 적어 주세요.');
      opts.project = resolve(argv[++i]);
    } else if (CLIS.includes(a.replace(/^--/, '')) && a.startsWith('--')) opts.clis.push(a.slice(2));
    else if (a === '--help' || a === '-h') {
      console.log('사용법: node scripts/install-skill.mjs [--claude] [--codex] [--gemini] [--project <폴더>] [--uninstall]');
      process.exit(0);
    } else fail(`알 수 없는 옵션: ${a}`);
  }
  return opts;
}

// Skill folders to write, with the CLIs each one serves.
function destinations({ clis, project }) {
  const home = homedir();
  if (project) {
    if (!existsSync(project)) fail(`프로젝트 폴더가 없습니다: ${project}`);
    const want = clis.length ? clis : CLIS;
    const out = [];
    if (want.includes('claude')) out.push({ dir: join(project, '.claude', 'skills', NAME), label: 'Claude Code' });
    const agents = want.filter((c) => c !== 'claude').map((c) => (c === 'codex' ? 'Codex' : 'Gemini CLI·Antigravity CLI'));
    if (agents.length) out.push({ dir: join(project, '.agents', 'skills', NAME), label: agents.join(', ') });
    return out;
  }
  const claudeHome = process.env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  const user = {
    claude: { dir: join(claudeHome, 'skills', NAME), label: 'Claude Code', present: existsSync(claudeHome) },
    codex: { dir: join(home, '.agents', 'skills', NAME), label: 'Codex (Gemini CLI도 읽음)', present: existsSync(process.env.CODEX_HOME || join(home, '.codex')) },
    gemini: { dir: join(home, '.gemini', 'skills', NAME), label: 'Gemini CLI·Antigravity CLI', present: existsSync(join(home, '.gemini')) },
  };
  const chosen = clis.length ? clis : CLIS.filter((c) => user[c].present);
  if (!chosen.length) fail('Claude Code, Codex, Gemini CLI 설정 폴더를 찾지 못했습니다. --claude / --codex / --gemini 로 직접 고르세요.');
  for (const c of CLIS) if (!chosen.includes(c) && !clis.length) console.log(`건너뜀: ${user[c].label} (설정 폴더 없음)`);
  return chosen.map((c) => user[c]);
}

// Never replace or delete a folder of the same name that some other skill owns.
function ours(dir) {
  const skill = join(dir, 'SKILL.md');
  return existsSync(skill) && /^name:\s*super-prompt-maker\s*$/m.test(readFileSync(skill, 'utf8'));
}

function install(dir) {
  if (existsSync(dir)) {
    if (!ours(dir)) fail(`${dir} 에 다른 스킬이 있어 덮어쓰지 않았습니다.`);
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dirname(dir), { recursive: true });
  cpSync(SOURCE, dir, { recursive: true });
  mkdirSync(join(dir, 'lib'), { recursive: true });
  for (const f of LIB_FILES) copyFileSync(join(ROOT, 'lib', f), join(dir, 'lib', f));
  // The installed copy must run on its own, without this repository.
  const check = spawnSync(process.execPath, [join(dir, 'scripts', 'spm.mjs'), 'brief', '--target', 'claude'], { encoding: 'utf8' });
  if (check.status !== 0 || !check.stdout.includes('Prompting best practices')) fail(`${dir} 설치 확인 실패:\n${check.stderr}`);
}

const opts = parse(process.argv.slice(2));
if (!existsSync(join(SOURCE, 'SKILL.md'))) fail(`스킬 원본이 없습니다: ${SOURCE}`);
for (const { dir, label } of destinations(opts)) {
  if (opts.uninstall) {
    if (!existsSync(dir)) { console.log(`없음: ${label} — ${dir}`); continue; }
    if (!ours(dir)) fail(`${dir} 는 이 스킬이 아니어서 지우지 않았습니다.`);
    rmSync(dir, { recursive: true, force: true });
    console.log(`삭제: ${label} — ${dir}`);
  } else {
    install(dir);
    console.log(`설치: ${label} — ${dir}`);
  }
}
if (!opts.uninstall) console.log('\n새 세션부터 쓸 수 있습니다. 예: "이 프롬프트 Claude용으로 다듬어줘: ..."');
