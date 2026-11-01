# Super Prompt Maker ✨

**한국어** | [English](README.en.md)

ChatGPT · Claude · Gemini · Perplexity · Grok · DeepSeek · Copilot · CLOVA X · 이미지 생성 AI에 맞춰
**서비스별 최적 프롬프트**를 만들어 주는 로컬 웹서비스입니다.

- 프롬프트 생성은 **접속한 사람 본인의** Claude / Codex / Gemini CLI 계정으로 실행됩니다. 서버 운영자의 토큰은 쓰지 않습니다.
- npm 패키지가 하나도 없습니다. Node.js만 있으면 바로 실행됩니다.
- 화면은 한국어이고, 폰트는 [페이퍼로지(Paperlogy)](https://freesentation.blog/paperlogyfont)를 내장했습니다.

## 주요 기능

| 탭 | 하는 일 |
|---|---|
| ✍️ 프롬프트 강화 | 직접 쓴 프롬프트를 목적에 맞춰, 고른 AI 서비스(최대 4개)마다 그 서비스가 권장하는 구조로 다시 씁니다. 서비스를 1개만 고르면 3가지 버전을 만듭니다. |
| 🧩 옵션으로 만들기 | 역할 · 작업 · 목적 · 독자 · 톤 · 형식 · 분량 · 기법만 고르면 **간결 실행형 / 구조화 전문가형 / 심화 대화형** 프롬프트 3개가 나옵니다. 주제 입력은 선택입니다. |
| 🕘 히스토리 | 생성 결과가 자동으로 저장됩니다. 검색, 유형 필터, 즐겨찾기(★), 같은 설정으로 다시 만들기, 삭제, Markdown/JSON 내보내기를 지원합니다. |
| ⭐ 저장함 | 결과 카드에서 저장한 프롬프트를 모아 두고 제목 · 내용 · 메모를 고칩니다. 직접 추가할 수도 있습니다. |
| 🔌 AI 연결 | 이 PC의 CLI 상태를 보거나, 다른 PC에서 접속한 사람이 자기 PC의 CLI를 연결합니다. |

서비스별로 이런 구조를 씁니다.

| 서비스 | 구조 |
|---|---|
| ChatGPT · Grok · 범용 | 마크다운 섹션 (`## 역할`, `## 작업 지시` …) |
| Claude | XML 태그 (`<role>`, `<instructions>`, `<output_format>` …) |
| Gemini | Persona-Task-Context-Format |
| Copilot | Goal-Context-Expectations-Source |
| Perplexity | 검색형 질문과 출처 요구 |
| 이미지 생성 | 키워드와 `--ar` 같은 파라미터 |

생성 엔진은 **Claude CLI · Codex CLI · Gemini CLI · 기본 엔진** 중에서 고릅니다. 기본 엔진은 오프라인 템플릿이라 토큰을 쓰지 않습니다.

## 빠른 시작 (서버 PC)

필요한 것은 Node.js 18 이상뿐입니다.

```bash
git clone https://github.com/himangga01/super-prompt-maker-ai.git
cd super-prompt-maker-ai
node server.mjs
```

Windows에서는 `start.bat`을 더블클릭해도 됩니다. 실행하면 아래 두 주소가 출력됩니다.

- 이 PC: `http://localhost:3000`
- 같은 네트워크의 다른 기기: `http://192.168.x.x:3000`

처음 실행할 때 Windows 방화벽 창이 뜨면 **개인 네트워크**만 허용하세요.

AI 생성을 쓰려면 그 PC에 아래 CLI 중 하나 이상이 설치되어 있고 로그인되어 있어야 합니다.

| CLI | 설치 · 로그인 |
|---|---|
| Claude Code | `claude` 설치 후 `claude auth login` |
| Codex | `codex` 설치 후 로그인 |
| Gemini | `gemini` 설치 후 로그인 |

## 각자 자기 AI 계정으로 쓰는 방법

```
 [접속자 브라우저] ──HTTP──▶ [서버 PC: server.mjs] ◀──long-polling── [접속자 PC: spm-bridge.mjs] ──stdin──▶ claude / codex / gemini
```

- **서버 PC에서 접속**(`localhost`)하면 서버 PC에 로그인된 CLI를 바로 씁니다.
- **다른 PC에서 접속**하면 서버 PC의 CLI는 쓸 수 없습니다. 서버가 막습니다. 대신 **AI 연결** 탭에서 연결합니다.
  1. 내 PC에 Node.js와 사용할 CLI를 설치하고 로그인합니다.
  2. **연결 코드 만들기**를 누릅니다. 코드는 10분 동안 유효하고 한 번만 쓸 수 있습니다.
  3. 화면에 나온 명령을 **내 PC** 터미널에서 실행합니다. PowerShell 예시:
     ```powershell
     irm http://192.168.0.34:3000/spm-bridge.mjs -OutFile spm-bridge.mjs; node spm-bridge.mjs --server http://192.168.0.34:3000 --code ABCD-EFGH
     ```
     macOS / Linux 예시:
     ```bash
     curl -fsSo spm-bridge.mjs http://192.168.0.34:3000/spm-bridge.mjs && node spm-bridge.mjs --server http://192.168.0.34:3000 --code ABCD-EFGH
     ```
  4. 브리지 창을 켜 두는 동안 이 브라우저에서 만드는 프롬프트는 **내 PC의 CLI(내 계정 토큰)** 로 생성됩니다. 다 쓰면 Ctrl+C로 끄세요.

브리지(`public/spm-bridge.mjs`)는 의존성이 없는 단일 파일입니다. 서버에 바깥 방향으로만 접속하기 때문에 내 PC에 포트를 열 필요가 없습니다.

## 설정 (환경 변수)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `HOST` | `0.0.0.0` | 바인딩 주소. 이 PC에서만 쓰려면 `127.0.0.1`로 지정하세요. |
| `ALLOWED_HOSTS` | (없음) | `localhost`와 이 PC의 IP 말고 허용할 호스트 이름. 쉼표로 구분합니다. 예: `myhost.local` |
| `SPM_DATA_DIR` | `data/users` | 사용자 데이터 폴더. 테스트에서 씁니다. |

## 보안 설계

- **고정된 CLI 실행:** 브리지와 로컬 실행기는 `claude`, `codex`, `gemini` 세 CLI만 **고정 인자**로 실행합니다. 프롬프트는 stdin으로만 넘기고, 실행할 때마다 빈 임시 폴더를 작업 폴더로 씁니다.
  - Claude: `-p --tools "" --strict-mcp-config --no-session-persistence` (도구와 MCP 없이 텍스트만)
  - Codex: `exec -s read-only --ephemeral --skip-git-repo-check -c model_reasoning_effort=medium`
  - Gemini: 비대화형 stdin 모드
- **서버 PC의 CLI 보호:** 루프백(`127.0.0.1`) 요청만 서버 PC의 CLI를 쓸 수 있습니다.
- **요청 검사:**
  - 브라우저 API는 같은 출처의 JSON 요청만 받습니다(CSRF 방지).
  - `localhost`, 이 PC의 IP, `ALLOWED_HOSTS`로 들어온 요청만 받습니다(DNS 리바인딩 방지).
- **브리지 인증:** 연결 코드는 10분 동안 한 번만 쓸 수 있습니다. 브리지 토큰은 브라우저(쿠키)마다 따로 발급됩니다.
- **시간 초과:** CLI는 360초가 지나면 프로세스 트리째 종료됩니다. 브리지는 연결이 끊기면 45초 안에 다시 연결합니다.
- **신뢰 범위:** 브리지는 서버가 보낸 프롬프트를 내 CLI로 실행합니다. Codex는 읽기 전용 샌드박스지만 파일을 *읽을* 수는 있습니다. **믿을 수 있는 서버에만** 연결하세요.
- **사용자 데이터:** 사용자 데이터는 `data/users/<쿠키ID>.json`에 저장되고 Git에는 올라가지 않습니다. 쿠키를 지우면 기록에 접근할 수 없으니 필요하면 **내보내기**를 하세요.

## 테스트

```bash
npm test            # 16개, 토큰 사용 없음, 약 1초
npm run test:cli    # 실제 Claude·Codex CLI로 생성 검사 (토큰 사용, 약 3분)
```

- `npm test`는 엔진 단위 테스트와, 서버를 실제로 띄워 하는 API 테스트입니다. API 테스트는 히스토리 · 저장함 · 보안 차단 · 브리지 흐름을 확인합니다. 테스트는 임시 데이터 폴더만 씁니다.
- `npm run test:cli`는 로그인된 CLI가 있어야 합니다. 한 CLI만 시험하려면 `SPM_CLI_PROVIDERS=codex`처럼 지정하세요.

2026-11-02에 측정한 실제 생성 시간입니다(동시에 여러 개를 실행한 상태).

| 작업 | Claude | Codex |
|---|---|---|
| 프롬프트 3개 | 약 1.5~3분 | 약 1.5분 |
| 2개 서비스 강화 | 약 1분 | 약 1분 |

## 폴더 구조

```
server.mjs              HTTP 서버 · 사용자/히스토리/저장함 · 브리지 연결 · 작업 큐
lib/catalog.mjs         서비스별 프롬프트 가이드, 역할·작업·목적 등 옵션
lib/engine.mjs          메타 프롬프트 생성 · AI 응답(JSON) 해석 · 오프라인 템플릿 엔진
public/spm-bridge.mjs   CLI 실행기(서버와 브리지가 함께 씀) + 브리지 클라이언트
public/                 프론트엔드 (index.html, app.js, styles.css, fonts/)
tests/                  node:test 테스트 (engine, server, 실제 CLI)
docs/code-analysis.md   코드 리뷰 · 검증 기록
AGENTS.md               AI 코딩 에이전트용 작업 규칙
```

## 문제 해결

- **"OAuth session expired" 또는 "Not logged in":** 터미널에서 `claude auth login`(또는 해당 CLI의 로그인)을 다시 실행하세요. Claude 데스크톱 앱의 로그인과 터미널 CLI의 로그인은 별개입니다.
- **엔진 버튼이 비활성:** 이 PC의 CLI가 없거나 브리지가 연결되지 않은 경우입니다. **AI 연결** 탭에서 상태를 확인하세요.
- **"허용되지 않은 호스트 이름" (421):** IP나 `localhost`가 아닌 이름으로 접속했다면 `ALLOWED_HOSTS`에 그 이름을 추가하세요.
- **생성이 오래 걸림:** 프롬프트 3개는 보통 1~3분 걸립니다. 빠른 결과가 필요하면 **기본 엔진**을 쓰세요.

## 알려진 한계

- Gemini CLI 경로는 아직 실제로 테스트하지 않았습니다.
- 다른 PC에서의 실제 접속과 실제 휴대폰 화면은 검증하지 않았습니다. 같은 PC에서 흉내 내 보고, 브라우저 화면 크기만 바꿔서 확인했습니다.
- 화면에서 모델을 고르는 기능은 아직 없습니다. 각 CLI의 기본 모델을 씁니다.

## 라이선스

- 폰트: [Paperlogy](https://freesentation.blog/paperlogyfont) — SIL Open Font License 1.1 ([public/fonts/OFL.txt](public/fonts/OFL.txt))
- 프로젝트 코드: 아직 라이선스를 정하지 않았습니다.
