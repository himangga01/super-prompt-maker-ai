// Options shown in the UI and the per-service prompting style the engine follows.
export const TARGETS = [
  { id: 'chatgpt', name: 'ChatGPT', vendor: 'OpenAI', style: 'markdown',
    guide: 'Use Markdown sections (## Role, ## Task, ## Context, ## Requirements, ## Output format). Put user material between triple quotes. State concrete success criteria, length and format. For reasoning models give the goal and constraints instead of telling it to "think step by step".' },
  { id: 'claude', name: 'Claude', vendor: 'Anthropic', style: 'xml',
    guide: 'Use XML tags (<role>, <context>, <task>, <instructions>, <constraints>, <output_format>, <examples>). Be explicit and explain WHY each constraint matters. Put long reference material first, the question last. Ask for the answer inside a named tag when parsing matters.' },
  { id: 'gemini', name: 'Gemini', vendor: 'Google', style: 'ptcf',
    guide: 'Follow Persona-Task-Context-Format. Use clear natural language with bullet constraints, give a few-shot example when format matters, split complex work into numbered steps, and specify the exact output format.' },
  { id: 'perplexity', name: 'Perplexity', vendor: 'Perplexity', style: 'search',
    guide: 'Search-first: ask one precise question, add timeframe, region and source requirements, ask for citations and a comparison table where useful. Skip long persona text.' },
  { id: 'grok', name: 'Grok', vendor: 'xAI', style: 'markdown',
    guide: 'Direct and concise. Allow a candid tone, mention real-time / X data when relevant, define format and length explicitly.' },
  { id: 'deepseek', name: 'DeepSeek', vendor: 'DeepSeek', style: 'plain',
    guide: 'Short direct instructions in the user turn. For reasoning (R-series) models avoid few-shot examples and system-style role text; state the goal, constraints and the exact output format.' },
  { id: 'copilot', name: 'Microsoft Copilot', vendor: 'Microsoft', style: 'gces',
    guide: 'Use Goal-Context-Expectations-Source. Start with an action verb, reference files/emails/meetings when relevant, keep it concise.' },
  { id: 'clova', name: 'CLOVA X', vendor: 'NAVER', style: 'plain',
    guide: 'Write natural, explicit Korean instructions with a short example, Korean context (laws, culture, terms) and a clear output format.' },
  { id: 'midjourney', name: '이미지 생성 (Midjourney 등)', vendor: 'Image', style: 'image',
    guide: 'Image prompt: subject, setting, style/medium, lighting, color, composition, camera/lens, mood, then parameters like --ar 16:9 --stylize 250. Comma-separated English keywords.' },
  { id: 'universal', name: '범용 (모든 AI)', vendor: 'Any', style: 'markdown',
    guide: 'Model-agnostic structure: role, goal, context, step-by-step instructions, constraints, output format, quality checklist.' },
];

const opts = (arr) => arr.map(([id, label]) => ({ id, label }));

export const ROLES = opts([
  ['marketer', '마케터'], ['developer', '개발자'], ['planner', '서비스 기획자'], ['designer', '디자이너'],
  ['teacher', '교사·강사'], ['researcher', '연구원'], ['writer', '작가·카피라이터'], ['analyst', '데이터 분석가'],
  ['admin', '행정사·법률 실무자'], ['consultant', '경영 컨설턴트'], ['student', '학생'], ['translator', '번역가'],
  ['hr', 'HR·채용 담당자'], ['sales', '영업 담당자'], ['founder', '창업가·대표'], ['creator', '유튜버·크리에이터'],
]);

export const TASKS = opts([
  ['write', '글쓰기'], ['summarize', '요약'], ['translate', '번역'], ['code', '코드 작성'], ['review', '코드 리뷰'],
  ['debug', '디버깅'], ['brainstorm', '아이디어 브레인스토밍'], ['research', '조사·리서치'], ['plan', '계획 수립'],
  ['email', '이메일 작성'], ['report', '보고서 작성'], ['proposal', '기획서·제안서'], ['copy', '마케팅 카피'],
  ['sns', 'SNS 콘텐츠'], ['explain', '개념 설명·학습'], ['proofread', '문서 검토·교정'], ['data', '데이터 분석'],
  ['image', '이미지 생성 프롬프트'], ['interview', '면접·질문 준비'], ['document', '공문·서식 작성'],
]);

export const GOALS = opts([
  ['inform', '정보 전달'], ['persuade', '설득·전환'], ['decide', '의사결정 지원'], ['learn', '학습·이해'],
  ['automate', '업무 효율화'], ['create', '창작'], ['solve', '문제 해결'], ['quality', '품질 개선'],
]);

export const AUDIENCES = opts([
  ['general', '일반 대중'], ['expert', '전문가'], ['executive', '경영진·의사결정자'], ['customer', '고객'],
  ['beginner', '입문자'], ['student', '학생'], ['team', '팀 동료'], ['public', '공공기관·관공서'],
]);

export const TONES = opts([
  ['professional', '전문적인'], ['friendly', '친근한'], ['concise', '간결한'], ['formal', '격식 있는'],
  ['persuasive', '설득력 있는'], ['creative', '창의적인'], ['warm', '따뜻한'], ['witty', '재치 있는'],
]);

export const FORMATS = opts([
  ['auto', 'AI가 판단'], ['markdown', '마크다운 문서'], ['bullets', '글머리 목록'], ['table', '표'],
  ['steps', '단계별 가이드'], ['paragraph', '서술형 문단'], ['json', 'JSON'], ['code', '코드 블록'],
]);

export const LENGTHS = opts([['short', '짧게'], ['medium', '보통'], ['long', '자세히']]);
export const LANGS = opts([['ko', '한국어'], ['en', '영어']]);

export const TECHNIQUES = opts([
  ['stepByStep', '단계별로 사고'], ['examples', '예시 포함'], ['clarify', '먼저 질문하기'],
  ['selfCheck', '자체 검증'], ['sources', '근거·출처 표시'], ['alternatives', '대안 제시'],
]);

export const PURPOSES = opts([
  ['general', '일반 품질 향상'], ['accuracy', '정확도·사실성'], ['creative', '창의성'], ['structure', '구조화된 결과'],
  ['coding', '코딩·개발'], ['business', '비즈니스 문서'], ['learning', '학습·설명'], ['research', '리서치'],
]);

export const ENGINES = [
  { id: 'claude', name: 'Claude CLI' },
  { id: 'codex', name: 'Codex CLI' },
  { id: 'gemini', name: 'Gemini CLI' },
  { id: 'template', name: '기본 엔진 (오프라인 템플릿)' },
];

export const catalog = { TARGETS, ROLES, TASKS, GOALS, AUDIENCES, TONES, FORMATS, LENGTHS, LANGS, TECHNIQUES, PURPOSES, ENGINES };

export const labelOf = (list, id) => list.find((o) => o.id === id)?.label || id || '';
export const targetOf = (id) => TARGETS.find((t) => t.id === id) || TARGETS.at(-1);
