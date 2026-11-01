import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRequest, buildMetaPrompt, parseAiOutput, templateGenerate } from '../lib/engine.mjs';

test('normalizeRequest caps, dedupes and defaults targets', () => {
  const r = normalizeRequest({ input: ' hi ', targets: ['claude', 'claude', 'chatgpt', 'gemini', 'grok', 'deepseek'] });
  assert.equal(r.mode, 'enhance');
  assert.equal(r.input, 'hi');
  assert.deepEqual(r.targets, ['claude', 'chatgpt', 'gemini', 'grok']);
  assert.equal(normalizeRequest({ mode: 'build', targets: ['claude', 'gemini'] }).targets.length, 1);
  assert.deepEqual(normalizeRequest({ targets: ['nope'] }).targets, ['universal']);
  assert.deepEqual(normalizeRequest({}).targets, ['universal']);
});

test('normalizeRequest sanitizes options', () => {
  const r = normalizeRequest({ mode: 'build', options: { lang: 'fr', techniques: ['examples', 'rm -rf', 'clarify'], format: '' } });
  assert.equal(r.options.lang, 'ko');
  assert.deepEqual(r.options.techniques, ['examples', 'clarify']);
  assert.equal(r.options.format, 'auto');
  assert.equal(r.options.length, 'medium');
});

test('buildMetaPrompt asks for the right number of prompts per mode', () => {
  const build = buildMetaPrompt(normalizeRequest({ mode: 'build', targets: ['claude'], options: { role: 'admin' } }));
  assert.match(build, /Write exactly 3 prompts/);
  assert.match(build, /XML tags/);
  const multi = buildMetaPrompt(normalizeRequest({ input: 'x', targets: ['chatgpt', 'gemini'] }));
  assert.match(multi, /Write exactly 2 prompts/);
  assert.match(multi, /"""\nx\n"""/);
  const single = buildMetaPrompt(normalizeRequest({ input: 'x', targets: ['gemini'] }));
  assert.match(single, /Write exactly 3 prompts/);
});

test('parseAiOutput accepts raw JSON, fenced JSON with prose, and maps unknown targets', () => {
  const req = normalizeRequest({ input: 'x', targets: ['claude'] });
  const raw = parseAiOutput('{"analysis":"a","prompts":[{"title":"t","target":"claude","prompt":"P1"}]}', req);
  assert.equal(raw.prompts[0].prompt, 'P1');
  const fenced = parseAiOutput('Sure!\n```json\n{"prompts":[{"target":"mystery","prompt":"P2"}]}\n```\nDone.', req);
  assert.equal(fenced.prompts[0].prompt, 'P2');
  assert.equal(fenced.prompts[0].target, 'universal');
  const prose = parseAiOutput('Here you go: {"prompts":[{"target":"gemini","prompt":"P3"}]} hope it helps', req);
  assert.equal(prose.prompts[0].target, 'gemini');
});

test('parseAiOutput falls back to raw text and rejects empty output', () => {
  const req = normalizeRequest({ input: 'x', targets: ['chatgpt'] });
  const fb = parseAiOutput('just a prompt, no json', req);
  assert.equal(fb.prompts.length, 1);
  assert.equal(fb.prompts[0].prompt, 'just a prompt, no json');
  assert.equal(fb.prompts[0].target, 'chatgpt');
  assert.throws(() => parseAiOutput('   ', req), /비어/);
  // Entries without a prompt string are dropped.
  assert.equal(parseAiOutput('{"prompts":[{"prompt":""},{"prompt":"ok"}]}', req).prompts.length, 1);
});

test('templateGenerate: build mode gives 3 variants in the target style', () => {
  const claude = templateGenerate(normalizeRequest({ mode: 'build', targets: ['claude'], options: { role: 'admin', task: 'document', goal: 'inform', audience: 'public' } }));
  assert.deepEqual(claude.prompts.map((p) => p.variant), ['간결 실행형', '구조화 전문가형', '심화 대화형']);
  assert.ok(claude.prompts.every((p) => p.prompt.startsWith('<role>')));
  // Korean object particle follows the final syllable.
  assert.match(claude.prompts[0].prompt, /공공기관·관공서를 대상으로/);
  assert.match(claude.prompts[0].prompt, /정보 전달을 달성/);
  assert.match(claude.prompts[2].prompt, /<before_you_start>/);

  const gpt = templateGenerate(normalizeRequest({ mode: 'build', targets: ['chatgpt'], options: { lang: 'en' } }));
  assert.match(gpt.prompts[1].prompt, /^## Role/);
});

test('templateGenerate: enhance mode embeds the input once per target', () => {
  const r = templateGenerate(normalizeRequest({ input: '엑셀 합치기', targets: ['chatgpt', 'perplexity', 'midjourney'] }));
  assert.deepEqual(r.prompts.map((p) => p.target), ['chatgpt', 'perplexity', 'midjourney']);
  assert.ok(r.prompts.every((p) => p.prompt.includes('엑셀 합치기')));
  assert.match(r.prompts[2].prompt, /--ar 16:9/);
});
