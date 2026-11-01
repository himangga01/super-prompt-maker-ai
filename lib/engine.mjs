// Builds the meta-prompt sent to the user's AI CLI, parses its answer,
// and provides an offline template engine used when no CLI is connected.
import {
  ROLES, TASKS, GOALS, AUDIENCES, TONES, FORMATS, LENGTHS, TECHNIQUES, PURPOSES, labelOf, targetOf,
} from './catalog.mjs';

const VARIANTS = [
  { id: 'quick', label: '간결 실행형', hint: 'short, immediately usable, only the essentials' },
  { id: 'structured', label: '구조화 전문가형', hint: 'fully structured with role, context, steps, constraints and output format' },
  { id: 'deep', label: '심화 대화형', hint: 'advanced: asks clarifying questions first, reasons in stages, self-verifies, offers alternatives' },
];

export function normalizeRequest(body = {}) {
  const mode = body.mode === 'build' ? 'build' : 'enhance';
  const targets = (Array.isArray(body.targets) ? body.targets : [body.targets])
    .filter((t) => typeof t === 'string').map((t) => targetOf(t).id);
  const uniq = [...new Set(targets)].slice(0, mode === 'build' ? 1 : 4);
  const o = body.options || {};
  const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max).trim() : '');
  return {
    mode,
    input: str(body.input, 12000),
    targets: uniq.length ? uniq : ['universal'],
    purpose: str(body.purpose, 40) || 'general',
    options: {
      role: str(o.role, 40), task: str(o.task, 40), goal: str(o.goal, 40), audience: str(o.audience, 40),
      tone: str(o.tone, 40), format: str(o.format, 40) || 'auto', length: str(o.length, 20) || 'medium',
      lang: o.lang === 'en' ? 'en' : 'ko',
      techniques: (Array.isArray(o.techniques) ? o.techniques : []).filter((t) => TECHNIQUES.some((x) => x.id === t)),
      topic: str(o.topic, 2000), extra: str(o.extra, 2000),
    },
  };
}

function slots(req) {
  const { mode, targets } = req;
  if (mode === 'build' || targets.length === 1) return VARIANTS.map((v) => ({ target: targets[0], variant: v }));
  return targets.map((t) => ({ target: t, variant: VARIANTS[1] }));
}

function describeOptions(req) {
  const o = req.options;
  const lines = [];
  if (o.role) lines.push(`- Role the AI should play: ${labelOf(ROLES, o.role)}`);
  if (o.task) lines.push(`- Task type: ${labelOf(TASKS, o.task)}`);
  if (o.goal) lines.push(`- Goal: ${labelOf(GOALS, o.goal)}`);
  if (o.audience) lines.push(`- Audience: ${labelOf(AUDIENCES, o.audience)}`);
  if (o.tone) lines.push(`- Tone: ${labelOf(TONES, o.tone)}`);
  if (o.format && o.format !== 'auto') lines.push(`- Output format: ${labelOf(FORMATS, o.format)}`);
  lines.push(`- Answer length: ${labelOf(LENGTHS, o.length)}`);
  if (o.techniques.length) lines.push(`- Techniques to include: ${o.techniques.map((t) => labelOf(TECHNIQUES, t)).join(', ')}`);
  if (o.topic) lines.push(`- Topic / details from the user: ${o.topic}`);
  if (o.extra) lines.push(`- Extra requirements: ${o.extra}`);
  return lines.join('\n');
}

export function buildMetaPrompt(req) {
  const list = slots(req);
  const lang = req.options.lang === 'en' ? 'English' : 'Korean';
  const targetsUsed = [...new Set(list.map((s) => s.target))].map(targetOf);
  const guides = targetsUsed.map((t) => `- ${t.id} (${t.name}): ${t.guide}`).join('\n');
  const plan = list.map((s, i) => `${i + 1}. target="${s.target}", variant="${s.variant.label}" — ${s.variant.hint}`).join('\n');
  const source = req.mode === 'enhance'
    ? `The user's original prompt (rewrite and strengthen it; keep its intent and facts, never invent facts):\n"""\n${req.input || '(empty)'}\n"""\nPurpose of the enhancement: ${labelOf(PURPOSES, req.purpose)}`
    : `The user did not type a prompt. Build the best prompts from these selected options:\n${describeOptions(req)}`;

  return `You are a world-class prompt engineer. Your only job is to write prompts that another AI will receive. Do not answer or perform the task yourself and do not use tools.

${source}
${req.mode === 'enhance' && describeOptions(req).trim() ? `\nOptional preferences:\n${describeOptions(req)}\n` : ''}
Prompting best practices per target service:
${guides}

Write exactly ${list.length} prompts, in this order:
${plan}

Rules:
- Write every prompt in ${lang}, ready to copy and paste.
- Follow the target service's style above precisely (e.g. XML tags for Claude, Markdown sections for ChatGPT).
- Include role, clear task, context, step-by-step instructions, constraints, output format and a quality check where the variant calls for it.
- Where the user must supply missing information, use a placeholder in square brackets like [회사명].
- The three variants must differ meaningfully, not just in length.

Return ONLY valid JSON (no code fences, no commentary) with this shape:
{"analysis":"<Korean, 1-2 sentences describing what the user wants>","prompts":[{"title":"<Korean short title>","target":"<target id>","variant":"<variant label>","prompt":"<full prompt text>","why":"<Korean, 1-2 sentences on why this prompt works>"}]}`;
}

export function parseAiOutput(text, req) {
  const cleaned = String(text || '').replace(/^﻿/, '').trim();
  const candidates = [];
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1]);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start > -1 && end > start) candidates.push(cleaned.slice(start, end + 1));
  candidates.push(cleaned);
  for (const c of candidates) {
    try {
      const data = JSON.parse(c);
      const prompts = (data.prompts || []).filter((p) => p && typeof p.prompt === 'string' && p.prompt.trim())
        .map((p, i) => ({
          title: String(p.title || `프롬프트 ${i + 1}`).slice(0, 120),
          target: targetOf(p.target || req.targets[0]).id,
          variant: String(p.variant || '').slice(0, 60),
          prompt: p.prompt.trim(),
          why: String(p.why || '').slice(0, 600),
        }));
      if (prompts.length) return { analysis: String(data.analysis || '').slice(0, 600), prompts };
    } catch { /* try next candidate */ }
  }
  if (!cleaned) throw new Error('AI 응답이 비어 있습니다.');
  // The CLI ignored the JSON contract; still give the user its text.
  return { analysis: 'AI가 JSON 형식을 지키지 않아 응답 원문을 그대로 표시합니다.',
    prompts: [{ title: 'AI 생성 프롬프트', target: req.targets[0], variant: '원문', prompt: cleaned, why: '' }] };
}

// ---------------- offline template engine ----------------
// Picks 을/를 from the last Hangul syllable (batchim or not).
const eul = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return `${w}${c >= 0 && c <= 11171 && c % 28 ? "을" : "를"}`; };
const HEAD = {
  ko: { role: '역할', goal: '목표', context: '맥락', task: '작업 지시', constraints: '제약 조건', format: '출력 형식', check: '품질 점검', input: '입력 자료', questions: '시작 전 질문' },
  en: { role: 'Role', goal: 'Goal', context: 'Context', task: 'Instructions', constraints: 'Constraints', format: 'Output format', check: 'Quality check', input: 'Input', questions: 'Before you start' },
};

function lengthText(len, ko) {
  const m = { short: ko ? '핵심만 짧게 (5문장 이내)' : 'brief (under 5 sentences)', medium: ko ? '적당한 분량 (300~600자 내외)' : 'moderate length', long: ko ? '충분히 자세하게' : 'thorough and detailed' };
  return m[len] || m.medium;
}

function techniqueLines(techs, ko) {
  const m = {
    stepByStep: ko ? '복잡한 부분은 단계를 나눠 차근차근 판단한 뒤 결론을 제시하세요.' : 'Work through complex parts in stages before concluding.',
    examples: ko ? '이해를 돕는 구체적인 예시를 1~2개 포함하세요.' : 'Include 1-2 concrete examples.',
    clarify: ko ? '정보가 부족하면 답하기 전에 꼭 필요한 질문을 최대 3개 먼저 하세요.' : 'If information is missing, ask up to 3 essential questions first.',
    selfCheck: ko ? '답변을 마치기 전에 요구사항을 모두 충족했는지 스스로 점검하고 부족한 점을 보완하세요.' : 'Before finishing, verify every requirement is met and fix gaps.',
    sources: ko ? '사실 주장에는 근거나 출처를 함께 표시하고, 불확실하면 그렇다고 밝히세요.' : 'Cite evidence or sources for factual claims; flag uncertainty.',
    alternatives: ko ? '주요 대안 1~2가지와 장단점을 함께 제시하세요.' : 'Offer 1-2 alternatives with trade-offs.',
  };
  return techs.map((t) => m[t]).filter(Boolean);
}

function sectionsFor(req, variant) {
  const o = req.options;
  const ko = o.lang !== 'en';
  const role = o.role ? labelOf(ROLES, o.role) : (ko ? '해당 분야의 숙련된 전문가' : 'a seasoned expert in this field');
  const task = o.task ? labelOf(TASKS, o.task) : '';
  const goal = o.goal ? labelOf(GOALS, o.goal) : labelOf(PURPOSES, req.purpose);
  const audience = o.audience ? labelOf(AUDIENCES, o.audience) : '';
  const tone = o.tone ? labelOf(TONES, o.tone) : (ko ? '명확하고 전문적인' : 'clear, professional');
  const topic = o.topic || (ko ? '[주제 또는 상세 내용을 입력하세요]' : '[describe your topic]');
  const userText = req.mode === 'enhance' ? (req.input || topic) : '';

  const s = {
    role: ko ? `당신은 10년 이상 경력의 ${role}입니다. ${audience ? `${eul(audience)} 대상으로 ` : ''}${tone} 어조로 작업합니다.`
      : `You are ${role} with 10+ years of experience, writing in a ${tone} tone${audience ? ` for ${audience}` : ''}.`,
    goal: req.mode === 'enhance'
      ? (ko ? `아래 요청을 ${goal} 관점에서 최고 수준으로 수행하는 것이 목표입니다.` : `Deliver the request below at the highest quality, optimizing for ${goal}.`)
      : (ko ? `${task ? `${task} 작업을 통해 ` : ''}${eul(goal)} 달성하는 결과물을 만드는 것이 목표입니다.` : `Produce work that achieves ${goal}${task ? ` through ${task}` : ''}.`),
    context: req.mode === 'enhance' ? '' : (ko ? `주제/상황: ${topic}` : `Topic / situation: ${topic}`),
    input: userText,
    task: ko ? [
      '요청의 핵심 목적과 독자를 먼저 파악하세요.',
      task ? `${task}에 맞는 구성으로 결과물을 작성하세요.` : '요청에 가장 적합한 구성으로 결과물을 작성하세요.',
      '중요한 내용부터 우선순위에 따라 전달하세요.',
    ] : [
      'Identify the core purpose and audience first.',
      `Produce the result with a structure that fits ${task || 'the request'}.`,
      'Lead with the most important points.',
    ],
    constraints: [
      ...(ko ? ['사실이 아닌 내용을 지어내지 마세요.', `분량: ${lengthText(o.length, ko)}`] : ['Do not invent facts.', `Length: ${lengthText(o.length, ko)}`]),
      ...(o.extra ? [o.extra] : []),
    ],
    format: o.format && o.format !== 'auto' ? labelOf(FORMATS, o.format) : (ko ? '내용에 가장 적합한 형식 (제목과 소제목 활용)' : 'Best-fitting format with headings'),
    check: techniqueLines(o.techniques, ko),
    questions: [],
  };

  if (variant.id === 'quick') {
    s.task = s.task.slice(1, 2);
    s.check = [];
  } else if (variant.id === 'deep') {
    s.questions = ko ? ['작업을 시작하기 전에 목적·독자·제약에 대해 꼭 필요한 질문을 3개 이내로 하고, 답을 받은 뒤 진행하세요.']
      : ['Before starting, ask up to 3 essential questions about purpose, audience and constraints, then proceed.'];
    s.task.push(ko ? '초안을 작성한 뒤 비판적으로 검토하고 개선한 최종본을 제시하세요.' : 'Draft, critique, then present an improved final version.');
    const extra = techniqueLines(['stepByStep', 'selfCheck', 'alternatives'].filter((t) => !o.techniques.includes(t)), ko);
    s.check = [...s.check, ...extra];
  }
  return s;
}

function render(style, s, lang) {
  const h = HEAD[lang];
  const list = (arr) => arr.map((x, i) => `${i + 1}. ${x}`).join('\n');
  const bullets = (arr) => arr.map((x) => `- ${x}`).join('\n');
  if (style === 'image') {
    const subject = s.input || s.context.replace(/^[^:]+:\s*/, '');
    return `${subject}, highly detailed, cinematic lighting, rich color palette, balanced composition, 50mm lens, sharp focus, award-winning photography --ar 16:9 --stylize 250`;
  }
  if (style === 'xml') {
    const parts = [`<role>\n${s.role}\n</role>`];
    if (s.input) parts.unshift(`<input>\n${s.input}\n</input>`);
    parts.push(`<goal>\n${s.goal}\n</goal>`);
    if (s.context) parts.push(`<context>\n${s.context}\n</context>`);
    if (s.questions.length) parts.push(`<before_you_start>\n${s.questions.join('\n')}\n</before_you_start>`);
    parts.push(`<instructions>\n${list(s.task)}\n</instructions>`);
    parts.push(`<constraints>\n${bullets(s.constraints)}\n</constraints>`);
    parts.push(`<output_format>\n${s.format}\n</output_format>`);
    if (s.check.length) parts.push(`<quality_check>\n${bullets(s.check)}\n</quality_check>`);
    return parts.join('\n\n');
  }
  if (style === 'search') {
    return [s.input || s.context, '', `${h.goal}: ${s.goal}`, bullets([...s.constraints, ...(lang === 'ko' ? ['최신 정보 기준으로 답하고 출처 링크를 표시하세요.'] : ['Use up-to-date information and cite source links.'])]), `${h.format}: ${s.format}`].filter((x) => x !== undefined).join('\n');
  }
  if (style === 'plain' || style === 'gces' || style === 'ptcf') {
    const labels = style === 'gces'
      ? { role: 'Goal', context: 'Context', task: 'Expectations', format: 'Source/Format' }
      : style === 'ptcf' ? { role: 'Persona', context: 'Context', task: 'Task', format: 'Format' }
        : { role: h.role, context: h.context, task: h.task, format: h.format };
    const out = [`${labels.role}: ${style === 'gces' ? s.goal : s.role}`];
    if (style !== 'gces') out.push(`${h.goal}: ${s.goal}`);
    if (s.context || s.input) out.push(`${labels.context}: ${s.context || ''}${s.input ? `\n"""\n${s.input}\n"""` : ''}`);
    if (s.questions.length) out.push(`${h.questions}: ${s.questions.join(' ')}`);
    out.push(`${labels.task}:\n${list(s.task)}`);
    out.push(`${h.constraints}:\n${bullets(s.constraints)}`);
    out.push(`${labels.format}: ${s.format}`);
    if (s.check.length) out.push(`${h.check}:\n${bullets(s.check)}`);
    return out.join('\n\n');
  }
  // markdown
  const out = [`## ${h.role}\n${s.role}`, `## ${h.goal}\n${s.goal}`];
  if (s.context) out.push(`## ${h.context}\n${s.context}`);
  if (s.input) out.push(`## ${h.input}\n"""\n${s.input}\n"""`);
  if (s.questions.length) out.push(`## ${h.questions}\n${s.questions.join('\n')}`);
  out.push(`## ${h.task}\n${list(s.task)}`);
  out.push(`## ${h.constraints}\n${bullets(s.constraints)}`);
  out.push(`## ${h.format}\n${s.format}`);
  if (s.check.length) out.push(`## ${h.check}\n${bullets(s.check)}`);
  return out.join('\n\n');
}

export function templateGenerate(req) {
  const lang = req.options.lang === 'en' ? 'en' : 'ko';
  const prompts = slots(req).map(({ target, variant }) => {
    const t = targetOf(target);
    return {
      title: `${t.name} · ${variant.label}`,
      target: t.id,
      variant: variant.label,
      prompt: render(t.style, sectionsFor(req, variant), lang),
      why: `${t.name} 권장 구조(${t.style === 'xml' ? 'XML 태그' : t.style === 'ptcf' ? 'Persona-Task-Context-Format' : t.style === 'gces' ? 'Goal-Context-Expectations-Source' : t.style === 'search' ? '검색형 질문' : t.style === 'image' ? '이미지 키워드' : '마크다운 섹션'})에 맞춘 ${variant.label} 템플릿입니다.`,
    };
  });
  return { analysis: '기본 엔진(오프라인 템플릿)으로 생성했습니다. AI CLI를 연결하면 내용에 맞춘 더 정교한 프롬프트를 받을 수 있습니다.', prompts };
}
