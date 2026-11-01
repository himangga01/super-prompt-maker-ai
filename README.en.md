# Super Prompt Maker ✨

[한국어](README.md) | **English**

A local web service that writes **prompts optimized for each AI service**: ChatGPT, Claude, Gemini,
Perplexity, Grok, DeepSeek, Copilot, CLOVA X and image generators.

- Prompts are generated with **the visitor's own** Claude / Codex / Gemini CLI account, never the server owner's tokens.
- No npm dependencies. Node.js is all you need.
- The UI is in Korean and uses the bundled [Paperlogy](https://freesentation.blog/paperlogyfont) font.

## Features

| Tab | What it does |
|---|---|
| ✍️ Enhance (프롬프트 강화) | Rewrites your own prompt for its purpose, once per selected AI service (up to 4), in the structure that service recommends. Pick a single service to get 3 versions. |
| 🧩 Build from options (옵션으로 만들기) | Pick role, task, goal, audience, tone, format, length and techniques, and get 3 prompts: **quick, structured expert and deep conversational**. A topic is optional. |
| 🕘 History (히스토리) | Every result is saved automatically. You can search, filter by type, star, re-run with the same settings, delete, and export to Markdown or JSON. |
| ⭐ Library (저장함) | Keep prompts saved from result cards, and edit their title, text and memo. You can also add prompts by hand. |
| 🔌 AI connection (AI 연결) | See this PC's CLIs, or connect the CLIs on a visitor's own PC. |

Structure used per service:

| Service | Structure |
|---|---|
| ChatGPT, Grok, universal | Markdown sections |
| Claude | XML tags (`<role>`, `<instructions>`, `<output_format>` …) |
| Gemini | Persona-Task-Context-Format |
| Copilot | Goal-Context-Expectations-Source |
| Perplexity | Search-style question with source requirements |
| Image generators | Keywords plus parameters such as `--ar` |

Engines: **Claude CLI, Codex CLI, Gemini CLI, or the built-in offline template engine** (uses no tokens).

## Quick start (server PC)

Requirements: Node.js 18 or later.

```bash
git clone https://github.com/himangga01/super-prompt-maker-ai.git
cd super-prompt-maker-ai
node server.mjs
```

On Windows you can also double-click `start.bat`. The server prints two URLs:

- this PC: `http://localhost:3000`
- other devices on the same network: `http://192.168.x.x:3000`

If the Windows firewall asks on first run, allow **private networks** only.

To use AI generation, install and log in to at least one of these CLIs on that PC:

| CLI | Install and log in |
|---|---|
| Claude Code | install `claude`, then `claude auth login` |
| Codex | install `codex`, then log in |
| Gemini | install `gemini`, then log in |

## Using your own AI account

```
 [visitor's browser] ──HTTP──▶ [server PC: server.mjs] ◀──long-polling── [visitor's PC: spm-bridge.mjs] ──stdin──▶ claude / codex / gemini
```

- **On the server PC** (`localhost`), the CLIs logged in on that PC are used directly.
- **From another PC**, the server refuses to run the server PC's CLIs. Use the **AI 연결** tab instead:
  1. Install Node.js and the CLI you want on your own PC, and log in.
  2. Click **연결 코드 만들기** (create pairing code). The code is valid for 10 minutes and works once.
  3. Run the command shown on screen in a terminal on **your PC**. PowerShell example:
     ```powershell
     irm http://192.168.0.34:3000/spm-bridge.mjs -OutFile spm-bridge.mjs; node spm-bridge.mjs --server http://192.168.0.34:3000 --code ABCD-EFGH
     ```
     macOS / Linux example:
     ```bash
     curl -fsSo spm-bridge.mjs http://192.168.0.34:3000/spm-bridge.mjs && node spm-bridge.mjs --server http://192.168.0.34:3000 --code ABCD-EFGH
     ```
  4. While the bridge window is open, prompts you generate in that browser run on **your PC's CLI, with your account's tokens**. Press Ctrl+C when you are done.

The bridge (`public/spm-bridge.mjs`) is a single dependency-free file. It only connects outward to the
server, so you don't need to open a port on your PC.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` to keep it on this PC only. |
| `ALLOWED_HOSTS` | (none) | Extra host names to accept besides `localhost` and this PC's IPs, comma-separated, e.g. `myhost.local` |
| `SPM_DATA_DIR` | `data/users` | User data folder; used by the tests |

## Security design

- **Fixed CLI runs:** The bridge and the local runner run only `claude`, `codex` and `gemini`, with **fixed arguments**. Prompt text goes through stdin only, and each run uses a fresh empty temp folder as its working directory.
  - Claude: `-p --tools "" --strict-mcp-config --no-session-persistence` (text only, no tools, no MCP)
  - Codex: `exec -s read-only --ephemeral --skip-git-repo-check -c model_reasoning_effort=medium`
  - Gemini: non-interactive stdin mode
- **Server PC CLIs:** Only loopback (`127.0.0.1`) requests may use them.
- **Request checks:**
  - Browser API calls must be same-origin JSON (CSRF protection).
  - Only requests addressed to `localhost`, this PC's IPs or `ALLOWED_HOSTS` are accepted (DNS-rebinding protection).
- **Bridge auth:** Pairing codes are single-use and expire after 10 minutes. Each browser (cookie) gets its own bridge token.
- **Timeouts:** A CLI run is killed with its whole process tree after 360 s. The bridge reconnects within 45 s after a dead connection.
- **Trust boundary:** The bridge runs prompts the server sends. Codex runs in a read-only sandbox but can still *read* files. Connect a bridge **only to servers you trust**.
- **User data:** User data lives in `data/users/<cookie-id>.json` and is git-ignored. Clearing cookies loses access to that history, so use **export** if you need a backup.

## Tests

```bash
npm test            # 16 tests, no tokens, about 1 s
npm run test:cli    # real Claude/Codex generation (spends tokens, about 3 min)
```

- `npm test` runs engine unit tests and API tests against a real server: history, library, security checks and the bridge flow. Tests use a temporary data folder.
- `npm run test:cli` needs logged-in CLIs. Limit it to one CLI with e.g. `SPM_CLI_PROVIDERS=codex`.

Measured generation times on 2026-11-02, with several runs in parallel:

| Task | Claude | Codex |
|---|---|---|
| 3 prompts | about 1.5–3 min | about 1.5 min |
| Enhance for 2 services | about 1 min | about 1 min |

## Project layout

```
server.mjs              HTTP server, users/history/library, bridge pairing, job queue
lib/catalog.mjs         Per-service prompting guides; role/task/goal option lists
lib/engine.mjs          Meta-prompt builder, AI JSON parser, offline template engine
public/spm-bridge.mjs   CLI runner (shared by server and bridge) + bridge client
public/                 Frontend (index.html, app.js, styles.css, fonts/)
tests/                  node:test suites (engine, server, real CLI)
docs/code-analysis.md   Code review and verification record
AGENTS.md               Working rules for AI coding agents
```

## Troubleshooting

- **"OAuth session expired" or "Not logged in":** run `claude auth login` (or the matching CLI's login) in a terminal. The Claude desktop app's login is separate from the terminal CLI's login.
- **Engine buttons are disabled:** this PC has no CLI, or no bridge is connected. Check the **AI 연결** tab.
- **"허용되지 않은 호스트 이름" (421):** you connected using a name other than an IP or `localhost`. Add it to `ALLOWED_HOSTS`.
- **Generation is slow:** 3 prompts usually take 1–3 minutes. Use the **built-in engine** for instant results.

## Known limitations

- The Gemini CLI path has not been tested against a real Gemini CLI yet.
- Real second-PC access and real phones are unverified. These were simulated on one PC and with browser viewport emulation.
- There is no model picker in the UI yet. Each CLI's default model is used.

## License

- Font: [Paperlogy](https://freesentation.blog/paperlogyfont), SIL Open Font License 1.1 ([public/fonts/OFL.txt](public/fonts/OFL.txt))
- Project code: no license chosen yet.
