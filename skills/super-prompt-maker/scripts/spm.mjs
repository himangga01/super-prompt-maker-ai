#!/usr/bin/env node
// Super Prompt Maker skill helper. Prints the brief an agent (Claude Code, Codex, Gemini CLI) follows to
// write prompts tuned for one or more AI services: the same guides and rules the web service sends to the CLIs.
//
//   node spm.mjs brief --target claude [--target chatgpt ...] [--lang ko|en] [--purpose general]
//   node spm.mjs list
//
// Only ids go on the command line. The user's own text stays in the agent's conversation, so it never
// passes through a shell (no quoting or console-encoding problems, nothing to inject).
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// An installed copy carries its own lib/ (scripts/install-skill.mjs puts it there); inside the
// repository the skill uses the service's lib/ directly, so there is one source of truth.
const libDir = [join(here, '..', 'lib'), join(here, '..', '..', '..', 'lib')].find((d) => existsSync(join(d, 'engine.mjs')));
if (!libDir) {
  console.error('Super Prompt Maker: lib/engine.mjs not found. Reinstall with `node scripts/install-skill.mjs` from the repository.');
  process.exit(1);
}
const load = (name) => import(pathToFileURL(join(libDir, name)).href);
const [{ normalizeRequest, buildMetaPrompt }, { TARGETS, PURPOSES }] = await Promise.all([load('engine.mjs'), load('catalog.mjs')]);

const MAX_TARGETS = 4;
const USAGE = `Usage:
  node spm.mjs brief --target <id> [--target <id> ...] [--lang ko|en] [--purpose <id>]
  node spm.mjs list

Targets (up to ${MAX_TARGETS}): ${TARGETS.map((t) => t.id).join(', ')}
Purposes: ${PURPOSES.map((p) => p.id).join(', ')}`;

function fail(message) {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

function parse(argv) {
  const [command, ...rest] = argv;
  const opts = { targets: [], lang: 'ko', purpose: 'general' };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (!['--target', '--lang', '--purpose'].includes(flag)) fail(`Unknown argument: ${flag}`);
    if (value === undefined || value.startsWith('--')) fail(`${flag} needs a value`);
    i++;
    if (flag === '--target') opts.targets.push(...value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    else if (flag === '--lang') opts.lang = value.toLowerCase();
    else opts.purpose = value.toLowerCase();
  }
  return { command, opts };
}

const { command, opts } = parse(process.argv.slice(2));

if (command === 'list') {
  console.log('Targets:');
  for (const t of TARGETS) console.log(`  ${t.id.padEnd(11)} ${t.name}`);
  console.log('Purposes:');
  for (const p of PURPOSES) console.log(`  ${p.id.padEnd(11)} ${p.en}`);
} else if (command === 'brief') {
  const unknown = opts.targets.filter((id) => !TARGETS.some((t) => t.id === id));
  if (unknown.length) fail(`Unknown target: ${unknown.join(', ')}`);
  const targets = [...new Set(opts.targets)];
  if (targets.length > MAX_TARGETS) fail(`At most ${MAX_TARGETS} targets at once (got ${targets.length})`);
  if (!['ko', 'en'].includes(opts.lang)) fail(`--lang must be ko or en (got ${opts.lang})`);
  if (!PURPOSES.some((p) => p.id === opts.purpose)) fail(`Unknown purpose: ${opts.purpose}`);
  const req = normalizeRequest({ mode: 'enhance', targets: targets.length ? targets : ['universal'], purpose: opts.purpose, options: { lang: opts.lang } });
  console.log(buildMetaPrompt(req, { forAgent: true }));
} else if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
  console.log(USAGE);
} else {
  fail(`Unknown command: ${command}`);
}
