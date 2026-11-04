# Super Prompt Maker ✨

**한국어** | [English](README.en.md)

ChatGPT · Claude · Gemini · Perplexity · Grok · DeepSeek · Copilot · HyperCLOVA X · 이미지 생성 AI에 맞춰
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

다른 기기에서 접속하려면 먼저 Windows 설정 → 네트워크 및 인터넷 → 지금 쓰는 Wi-Fi의 **네트워크 프로필 유형을 '개인'** 으로 바꾸세요. Windows는 새 Wi-Fi를 '공용'으로 두는데, 그러면 다른 기기의 접속이 막힙니다. 처음 실행할 때 방화벽 창이 뜨면 **개인 네트워크**만 허용하세요.

AI 생성을 쓰려면 그 PC에 아래 CLI 중 하나 이상이 설치되어 있고 로그인되어 있어야 합니다.

| CLI | 설치 · 로그인 |
|---|---|
| Claude Code | `claude` 설치 후 `claude auth login` |
| Codex | `codex` 설치 후 `codex login` |
| Gemini | `gemini` 설치 후 `gemini`를 실행해 로그인 |

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
     $f = Join-Path $env:TEMP 'spm-bridge.mjs'; irm http://192.168.0.34:3000/spm-bridge.mjs -OutFile $f; if ($?) { node $f --server http://192.168.0.34:3000 --code ABCD-EFGH }
     ```
     macOS / Linux 예시:
     ```bash
     f="${TMPDIR:-/tmp}/spm-bridge.mjs"; curl -fsSo "$f" http://192.168.0.34:3000/spm-bridge.mjs && node "$f" --server http://192.168.0.34:3000 --code ABCD-EFGH
     ```
  4. 브리지 창을 켜 두는 동안 이 브라우저에서 만드는 프롬프트는 **내 PC의 CLI(내 계정 토큰)** 로 생성됩니다. 다 쓰면 Ctrl+C로 끄세요.

  명령은 브리지 파일을 임시 폴더에 받고, 받기에 성공했을 때만 실행합니다. 휴대폰에서 연결 코드를 만들고 명령은 내 PC에서 실행해도 됩니다. 그러면 휴대폰에서 만드는 프롬프트가 내 PC의 CLI로 생성됩니다.

브리지(`public/spm-bridge.mjs`)는 의존성이 없는 단일 파일입니다. 서버에 바깥 방향으로만 접속하기 때문에 내 PC에 포트를 열 필요가 없습니다.

## 에이전트 스킬로 쓰기 (Claude Code · Codex · Gemini CLI)

웹 화면 없이 터미널의 AI 에이전트에서 바로 쓸 수도 있습니다. 스킬 `super-prompt-maker`를 설치한 뒤 평소처럼 "이 프롬프트 Claude용으로 다듬어줘: …"라고 요청하면, 에이전트가 스킬을 찾아 서비스별 프롬프트를 만들어 줍니다.

```bash
node scripts/install-skill.mjs                       # 이 PC에 설정 폴더가 있는 CLI 모두
node scripts/install-skill.mjs --gemini              # 고른 CLI만 (--claude / --codex / --gemini)
node scripts/install-skill.mjs --project 프로젝트폴더   # 한 프로젝트에만
node scripts/install-skill.mjs --uninstall           # 지우기 (같은 옵션으로 대상 지정)
```

| CLI | 설치 위치 | 직접 부르기 |
|---|---|---|
| Claude Code | `~/.claude/skills/super-prompt-maker` | `/super-prompt-maker` |
| Codex | `~/.agents/skills/super-prompt-maker` | `$super-prompt-maker` |
| Gemini CLI · Antigravity CLI | `~/.gemini/skills/super-prompt-maker` (Gemini CLI는 `~/.agents/skills`도 읽습니다) | `/skills list`로 확인 |

- 스킬 안의 `scripts/spm.mjs`가 웹 서비스와 같은 지침(서비스별 가이드, 규칙, 3가지 버전 구성)을 출력하고, 에이전트가 그 지침대로 프롬프트를 씁니다. 명령줄에는 서비스 ID만 넘기고 내가 쓴 문장은 넘기지 않습니다.
- 서비스를 1개 고르면 3가지 버전, 2~4개 고르면 서비스마다 1개씩 만듭니다. 결과는 버전마다 제목, 복사할 프롬프트, "왜 효과적인가" 한 줄로 나옵니다.
- 설치본에는 `lib/`의 엔진이 함께 복사되어 저장소 없이도 동작합니다. 저장소를 업데이트했다면 설치 명령을 다시 실행하세요.
- 새 세션부터 인식됩니다. Node.js 18 이상이 필요합니다.
- 실제 Claude Code와 Codex에서 확인했습니다(`npm run test:cli`). Gemini CLI와 Antigravity CLI는 이 PC에 없어서, 공식 문서의 스킬 경로에 설치만 하고 실행해 보지는 않았습니다.

## 설정 (환경 변수)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `HOST` | `0.0.0.0` | 바인딩 주소. 이 PC에서만 쓰려면 `127.0.0.1`로 지정하세요(그러면 같은 네트워크 주소는 출력하지 않습니다). |
| `ALLOWED_HOSTS` | (없음) | `localhost`와 이 PC의 IP 말고 허용할 호스트 이름. 쉼표로 구분합니다. 예: `myhost.local` |
| `SPM_DATA_DIR` | `data/users` | 사용자 데이터 폴더. 테스트에서 씁니다. |
| `SPM_GEN_LIMIT` | `30` | 접속자 한 명이 1분에 보낼 수 있는 생성 요청 수 |
| `SPM_BRIDGE_ONLINE_MS` | `45000` | 신호가 이 시간 동안 없으면 브리지를 끊긴 것으로 봅니다. 테스트에서 줄여 씁니다. |

Windows PowerShell에서는 `$env:PORT=3001; node server.mjs`처럼 지정합니다.

## 보안 설계

- **고정된 CLI 실행:** 브리지와 로컬 실행기는 `claude`, `codex`, `gemini` 세 CLI만 **고정 인자**로 실행합니다. 프롬프트는 stdin으로만 넘기고, 실행할 때마다 빈 임시 폴더를 작업 폴더로 씁니다.
  - Claude: `-p --tools "" --strict-mcp-config --no-session-persistence --safe-mode` (도구·MCP 없이 텍스트만. `--safe-mode`로 내 훅·플러그인·스킬·CLAUDE.md도 끕니다)
  - Codex: `exec -s read-only --ephemeral --ignore-user-config --skip-git-repo-check -c model_reasoning_effort=medium --disable shell_tool --disable unified_exec …` (명령 실행·브라우저·컴퓨터 제어 도구를 모두 끈 텍스트 전용 실행입니다. `--ignore-user-config`로 내 `config.toml`을 통째로 읽지 않으므로 MCP 서버·훅뿐 아니라 직접 지정한 모델·공급자 설정도 쓰지 않고 기본 모델로 실행합니다. 로그인은 그대로 씁니다)
  - Gemini: 비대화형 stdin 모드. 매번 새로 만드는 빈 임시 폴더만 그 실행 동안 신뢰합니다(`GEMINI_CLI_TRUST_WORKSPACE`). Gemini에는 도구를 끄는 고정 옵션을 아직 넣지 않았고 실제 Gemini CLI로 시험하지도 않았습니다. 승인이 필요한 도구는 비대화형 모드에서 거부되지만 읽기 도구는 쓸 수 있을 수 있으니, 믿는 서버에만 연결하세요.
  - 예전 Claude Code가 `--safe-mode`를 모르면 그 옵션만 빼고 다시 실행합니다(도구·MCP는 여전히 꺼져 있습니다). 예전 Codex가 `--ignore-user-config`를 모르면 실행하지 않고 업데이트를 안내합니다. Codex가 모르는 기능 이름은 그 끄기 옵션만 빼고 다시 실행합니다.
- **서버 PC의 CLI 보호:** 루프백(`127.0.0.1`) 요청만 서버 PC의 CLI를 쓸 수 있습니다. `X-Forwarded-For` 같은 프록시 헤더가 붙은 요청은 루프백이어도 거부합니다. 리버스 프록시나 터널(cloudflared, Tailscale serve 등)로 외부에 열면 모든 방문자가 루프백으로 보이기 때문입니다. 그런 도구가 이 헤더를 붙이지 않는다면 서버 PC의 계정이 노출될 수 있으니, 이 서비스는 그런 식으로 외부에 공개하지 마세요.
- **요청 검사:**
  - 브라우저 API는 같은 출처의 JSON 요청만 받습니다(CSRF 방지).
  - `localhost`, 이 PC의 IP, `ALLOWED_HOSTS`로 들어온 요청만 받습니다(DNS 리바인딩 방지).
- **브리지 인증:** 연결 코드는 10분 동안 한 번만 쓸 수 있고, 연결 코드 만들기와 연결 시도는 1분에 20번까지만 받습니다. 브리지 토큰은 브라우저(쿠키)마다 따로 발급됩니다.
- **화면 보호:** 다른 사이트가 이 화면을 프레임 안에 넣지 못하게 막습니다(`X-Frame-Options: DENY`).
- **시간 초과:** CLI는 360초가 지나면 프로세스 트리째 종료됩니다(macOS·Linux에서는 프로세스 그룹 전체). 브리지는 생성하는 동안 20초마다 신호를 보냅니다. 신호가 45초 동안 없으면(브리지 창을 닫았거나 PC가 잠든 경우) 진행 중이던 생성을 바로 실패로 알립니다. 생성 결과를 서버에 보내지 못하면 몇 번 다시 보냅니다.
- **남용 제한:** 생성 요청은 접속자(IP)당 1분에 30번까지 받습니다. 대기 중인 요청(long-polling)은 접속자당 40개, 브리지당 1개만 열어 둡니다. 저장함은 사용자당 1,000개, 히스토리는 500개까지 보관합니다. 사용자 파일 저장이 실패해도 서버는 멈추지 않고 로그만 남깁니다. 손상된 사용자 파일은 덮어쓰지 않고 `.corrupt-<시각>` 이름으로 보관합니다.
- **네트워크와 쿠키:** 서버와 브리지는 같은 네트워크 안에서 암호화되지 않은 HTTP로 통신합니다. 브리지 파일도 HTTP로 받습니다. 사용자 구분은 쿠키 하나뿐이라, 같은 네트워크에서 통신을 엿볼 수 있는 사람은 쿠키를 가로채 내 기록을 보거나 내 브리지로 생성을 요청할 수 있습니다. 같은 PC의 다른 웹 앱도 이 쿠키를 덮어쓸 수 있습니다. 공용 Wi-Fi처럼 믿을 수 없는 네트워크에서는 쓰지 마세요.
- **신뢰 범위:** 브리지는 서버가 보낸 프롬프트를 내 CLI로 실행하고, 그 토큰은 내 계정에서 나갑니다. Claude와 Codex는 도구 없이 텍스트만 만들도록 실행하지만, 서버 운영자가 어떤 프롬프트를 보낼지는 막을 수 없습니다. **믿을 수 있는 서버에만** 연결하세요.
- **사용자 데이터:** 사용자 데이터는 `data/users/<쿠키ID>.json`에 저장되고 Git에는 올라가지 않습니다. 쿠키를 지우면 기록에 접근할 수 없으니 필요하면 **내보내기**를 하세요.

## 테스트

```bash
npm test            # 40개, 토큰 사용 없음, 약 3초
npm run test:cli    # 실제 Claude·Codex CLI로 생성 · 스킬 검사 (토큰 사용, 약 3~4분)
```

- `npm test`는 엔진 단위 테스트와, 서버를 실제로 띄워 하는 API 테스트, 에이전트 스킬(지침 스크립트, SKILL.md, 설치 스크립트) 테스트입니다. API 테스트는 히스토리 · 저장함 · 보안 차단(쿠키 검증, 프록시 요청의 서버 PC CLI 차단, 모델 이름 검사, 요청 수 제한) · 브리지 흐름(재연결, 중복 결과, 다른 브리지의 결과, 연결 해제, 끊긴 브리지)과 저장 실패 · 손상 파일 처리를 확인합니다. 테스트는 임시 폴더만 씁니다.
- `npm run test:cli`는 로그인된 CLI가 있어야 합니다. 한 CLI만 시험하려면 `SPM_CLI_PROVIDERS=codex`처럼 지정하세요. 스킬 검사는 임시 프로젝트에 스킬을 설치한 뒤, 실제 CLI가 평범한 요청만 보고 스킬을 찾아 프롬프트 3개를 만드는지 확인합니다.

2026-11-02 오후에 측정한 실제 생성 시간입니다(동시에 여러 개를 실행한 상태).

| 작업 | Claude | Codex |
|---|---|---|
| 프롬프트 3개 | 약 2분 | 약 1분 |
| 2개 서비스 강화 | 약 1분 | 약 30초 |

## 폴더 구조

```
server.mjs              HTTP 서버 · 사용자/히스토리/저장함 · 브리지 연결 · 작업 큐
lib/catalog.mjs         서비스별 프롬프트 가이드, 역할·작업·목적 등 옵션
lib/engine.mjs          메타 프롬프트 생성 · AI 응답(JSON) 해석 · 오프라인 템플릿 엔진
public/spm-bridge.mjs   CLI 실행기(서버와 브리지가 함께 씀) + 브리지 클라이언트
public/                 프론트엔드 (index.html, app.js, styles.css, fonts/)
skills/super-prompt-maker/  에이전트 스킬 (SKILL.md, scripts/spm.mjs)
scripts/install-skill.mjs   스킬 설치 (Claude Code · Codex · Gemini CLI)
tests/                  node:test 테스트 (engine, server, skill, 실제 CLI)
docs/code-analysis.md   코드 리뷰 · 검증 기록
AGENTS.md               AI 코딩 에이전트용 작업 규칙
```

## 문제 해결

- **"OAuth session expired" 또는 "Not logged in":** 터미널에서 `claude auth login`(또는 해당 CLI의 로그인)을 다시 실행하세요. Claude 데스크톱 앱의 로그인과 터미널 CLI의 로그인은 별개입니다.
- **엔진 버튼이 비활성:** 이 PC의 CLI가 없거나 브리지가 연결되지 않은 경우입니다. **AI 연결** 탭에서 상태를 확인하세요.
- **"허용되지 않은 호스트 이름" (421):** IP나 `localhost`가 아닌 이름으로 접속했다면 `ALLOWED_HOSTS`에 그 이름을 추가하세요.
- **다른 기기에서 접속이 안 됨:** 서버 PC의 Wi-Fi 네트워크 프로필이 '공용'이면 방화벽이 막습니다. '개인'으로 바꾸고, 방화벽에서 Node.js의 개인 네트워크 접속을 허용하세요. 두 기기가 같은 Wi-Fi에 있는지도 확인하세요.
- **"포트 3000을(를) 이미 다른 프로그램이 쓰고 있습니다":** 서버가 이미 켜져 있는지 확인하거나, `$env:PORT=3001; node server.mjs`(macOS/Linux: `PORT=3001 node server.mjs`)로 다른 포트를 쓰세요.
- **결과의 노란 [ ] 부분:** AI가 모르는 정보(회사명, 가격, 날짜 등)를 비워 둔 자리입니다. 내 내용으로 바꾼 뒤 붙여넣으세요.
- **생성이 오래 걸림:** 프롬프트 3개는 보통 1~3분 걸립니다. 빠른 결과가 필요하면 **기본 엔진**을 쓰세요.

## 알려진 한계

- Gemini CLI 경로(웹 서비스의 생성 엔진, 에이전트 스킬 모두)는 아직 실제로 테스트하지 않았습니다.
- 다른 PC에서의 실제 접속과 실제 휴대폰 화면은 검증하지 않았습니다. 같은 PC에서 흉내 내 보고, 브라우저 화면 크기만 바꿔서 확인했습니다.
- 화면에서 모델을 고르는 기능은 아직 없습니다. 각 CLI의 기본 모델을 씁니다.

## 라이선스

- 폰트: [Paperlogy](https://freesentation.blog/paperlogyfont) — SIL Open Font License 1.1 ([public/fonts/OFL.txt](public/fonts/OFL.txt))
- 프로젝트 코드: 아직 라이선스를 정하지 않았습니다.
