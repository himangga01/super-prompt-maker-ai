// Options shown in the UI and the per-service prompting style the engine follows.
// `reasoning: true` marks services whose current models reason on their own: prompts give goals,
// constraints and success criteria instead of prescribing "think step by step".
export const TARGETS = [
  { id: 'chatgpt', name: 'ChatGPT', vendor: 'OpenAI', style: 'markdown', reasoning: true,
    guide: 'Use Markdown sections (## Role, ## Task, ## Context, ## Requirements, ## Output format). Put user material between triple quotes or tags. State concrete success criteria, length and format, and keep instructions free of contradictions. Give the goal and constraints instead of telling it to "think step by step".' },
  { id: 'claude', name: 'Claude', vendor: 'Anthropic', style: 'xml',
    guide: 'Use XML tags (<role>, <context>, <task>, <instructions>, <constraints>, <output_format>, <examples>). Be explicit and explain WHY each constraint matters. Put long reference material first, the question last. Ask for the answer inside a named tag when parsing matters.' },
  { id: 'gemini', name: 'Gemini', vendor: 'Google', style: 'ptcf', reasoning: true,
    guide: 'Follow Persona-Task-Context-Format. Use clear natural language with bullet constraints, give a few-shot example when format matters, and specify the exact output format. Current models plan on their own, so state the goal and constraints rather than detailing reasoning steps.' },
  { id: 'perplexity', name: 'Perplexity', vendor: 'Perplexity', style: 'search',
    guide: 'Search-first: ask one precise question with timeframe, region and the kinds of sources to rely on, and ask for a comparison table where useful. Perplexity attaches citations automatically, so do not ask it to type out URLs or links. Skip long persona text.' },
  { id: 'grok', name: 'Grok', vendor: 'xAI', style: 'markdown', reasoning: true,
    guide: 'Direct and concise. Allow a candid tone, mention real-time / X data when relevant, define format and length explicitly.' },
  { id: 'deepseek', name: 'DeepSeek', vendor: 'DeepSeek', style: 'plain', reasoning: true,
    guide: 'Current DeepSeek models are hybrid (chat and thinking modes). Put short, direct instructions in the user turn; state the goal, constraints and the exact output format. In thinking mode skip few-shot examples and do not prescribe reasoning steps.' },
  { id: 'copilot', name: 'Microsoft Copilot', vendor: 'Microsoft', style: 'gces',
    guide: 'Use Goal-Context-Expectations-Source: the goal, why it is needed, what the answer should look like, and which files/emails/meetings/pages to use. Start with an action verb and keep it concise.' },
  { id: 'clova', name: 'HyperCLOVA X', vendor: 'NAVER', style: 'plain',
    guide: 'NAVER HyperCLOVA X (CLOVA Studio; the consumer CLOVA X chatbot closed on 2026-04-09). Write natural, explicit Korean instructions with a short example, Korean context (laws, culture, terms) and a clear output format.' },
  { id: 'midjourney', name: '이미지 생성 (Midjourney 등)', vendor: 'Image', style: 'image',
    guide: 'Image prompt in English: one vivid description of subject, setting, style/medium, lighting, color, composition and mood (descriptive sentence or comma-separated phrases). No role, steps, questions or checklists. Midjourney parameters such as --ar 16:9 --stylize 250 go only at the end; other image tools ignore them.' },
  { id: 'universal', name: '범용 (모든 AI)', vendor: 'Any', style: 'markdown',
    guide: 'Model-agnostic structure: role, goal, context, step-by-step instructions, constraints, output format, quality checklist.' },
];

const opts = (arr) => arr.map(([id, label, en]) => ({ id, label, en }));

export const ROLES = opts([
  ['marketer', '마케터', 'a marketer'], ['developer', '개발자', 'a software developer'], ['planner', '서비스 기획자', 'a product planner'],
  ['designer', '디자이너', 'a designer'], ['teacher', '교사·강사', 'a teacher'], ['researcher', '연구원', 'a researcher'],
  ['writer', '작가·카피라이터', 'a writer and copywriter'], ['analyst', '데이터 분석가', 'a data analyst'],
  ['admin', '행정사·법률 실무자', 'an administrative and legal practitioner'], ['consultant', '경영 컨설턴트', 'a management consultant'],
  ['tutor', '튜터·학습 코치', 'a tutor and study coach'], ['translator', '번역가', 'a translator'], ['hr', 'HR·채용 담당자', 'an HR and recruiting specialist'],
  ['sales', '영업 담당자', 'a sales representative'], ['founder', '창업가·대표', 'a startup founder'], ['creator', '유튜버·크리에이터', 'a YouTuber and content creator'],
]);

export const TASKS = opts([
  ['write', '글쓰기', 'writing'], ['summarize', '요약', 'summarizing'], ['translate', '번역', 'translation'], ['code', '코드 작성', 'writing code'],
  ['review', '코드 리뷰', 'code review'], ['debug', '디버깅', 'debugging'], ['brainstorm', '아이디어 브레인스토밍', 'brainstorming ideas'],
  ['research', '조사·리서치', 'research'], ['plan', '계획 수립', 'planning'], ['email', '이메일 작성', 'writing an email'],
  ['report', '보고서 작성', 'writing a report'], ['proposal', '기획서·제안서', 'writing a proposal'], ['copy', '마케팅 카피', 'marketing copy'],
  ['sns', 'SNS 콘텐츠', 'social media content'], ['explain', '개념 설명·학습', 'explaining a concept'], ['proofread', '문서 검토·교정', 'proofreading and editing'],
  ['data', '데이터 분석', 'data analysis'], ['image', '이미지 생성 프롬프트', 'an image-generation prompt'], ['interview', '면접·질문 준비', 'interview preparation'],
  ['document', '공문·서식 작성', 'official documents and forms'],
]);

export const GOALS = opts([
  ['inform', '정보 전달', 'informing'], ['persuade', '설득·전환', 'persuasion and conversion'], ['decide', '의사결정 지원', 'decision support'],
  ['learn', '학습·이해', 'learning and understanding'], ['automate', '업무 효율화', 'work efficiency'], ['create', '창작', 'creative work'],
  ['solve', '문제 해결', 'problem solving'], ['quality', '품질 개선', 'quality improvement'],
]);

export const AUDIENCES = opts([
  ['general', '일반 대중', 'the general public'], ['expert', '전문가', 'experts'], ['executive', '경영진·의사결정자', 'executives and decision makers'],
  ['customer', '고객', 'customers'], ['beginner', '입문자', 'beginners'], ['student', '학생', 'students'], ['team', '팀 동료', 'teammates'],
  ['public', '공공기관·관공서', 'public agencies'],
]);

export const TONES = opts([
  ['professional', '전문적인', 'professional'], ['friendly', '친근한', 'friendly'], ['concise', '간결한', 'concise'], ['formal', '격식 있는', 'formal'],
  ['persuasive', '설득력 있는', 'persuasive'], ['creative', '창의적인', 'creative'], ['warm', '따뜻한', 'warm'], ['witty', '재치 있는', 'witty'],
]);

export const FORMATS = opts([
  ['auto', 'AI가 판단', 'best fit'], ['markdown', '마크다운 문서', 'a Markdown document'], ['bullets', '글머리 목록', 'a bulleted list'],
  ['table', '표', 'a table'], ['steps', '단계별 가이드', 'a step-by-step guide'], ['paragraph', '서술형 문단', 'prose paragraphs'],
  ['json', 'JSON', 'JSON'], ['code', '코드 블록', 'a code block'],
]);

export const LENGTHS = opts([['short', '짧게', 'short'], ['medium', '보통', 'medium'], ['long', '자세히', 'detailed']]);
export const LANGS = opts([['ko', '한국어', 'Korean'], ['en', '영어', 'English']]);

export const TECHNIQUES = opts([
  ['stepByStep', '단계별로 사고', 'step-by-step thinking'], ['examples', '예시 포함', 'include examples'], ['clarify', '먼저 질문하기', 'ask questions first'],
  ['selfCheck', '자체 검증', 'self-check'], ['sources', '근거·출처 표시', 'cite evidence and sources'], ['alternatives', '대안 제시', 'offer alternatives'],
]);

export const PURPOSES = opts([
  ['general', '일반 품질 향상', 'overall quality'], ['accuracy', '정확도·사실성', 'accuracy and factuality'], ['creative', '창의성', 'creativity'],
  ['structure', '구조화된 결과', 'structured output'], ['coding', '코딩·개발', 'coding'], ['business', '비즈니스 문서', 'business writing'],
  ['learning', '학습·설명', 'learning and explanation'], ['research', '리서치', 'research'],
]);

export const ENGINES = [
  { id: 'claude', name: 'Claude CLI' },
  { id: 'codex', name: 'Codex CLI' },
  { id: 'gemini', name: 'Gemini CLI' },
  { id: 'template', name: '기본 엔진 (오프라인 템플릿)' },
];

export const catalog = { TARGETS, ROLES, TASKS, GOALS, AUDIENCES, TONES, FORMATS, LENGTHS, LANGS, TECHNIQUES, PURPOSES, ENGINES };

export const labelOf = (list, id, lang = 'ko') => {
  const o = list.find((x) => x.id === id);
  return (lang === 'en' ? o?.en : o?.label) || o?.label || id || '';
};
export const targetOf = (id) => TARGETS.find((t) => t.id === id) || TARGETS.at(-1);
