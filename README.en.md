# Super Prompt Maker ✨

[한국어](README.md) | **English**

A local web service that writes **prompts optimized for each AI service**: ChatGPT, Claude, Gemini,
Perplexity, Grok, DeepSeek, Copilot, HyperCLOVA X and image generators.

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

For other devices to connect, first set the Wi-Fi's **network profile type to Private** (Windows Settings → Network & internet). Windows marks new Wi-Fi networks as Public, which blocks other devices. If the firewall asks on first run, allow **private networks** only.

To use AI generation, install and log in to at least one of these CLIs on that PC:

| CLI | Install and log in |
|---|---|
| Claude Code | install `claude`, then `claude auth login` |
| Codex | install `codex`, then `codex login` |
| Gemini | install `gemini`, then run `gemini` to log in |

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
     $f = Join-Path $env:TEMP 'spm-bridge.mjs'; irm http://192.168.0.34:3000/spm-bridge.mjs -OutFile $f; if ($?) { node $f --server http://192.168.0.34:3000 --code ABCD-EFGH }
     ```
     macOS / Linux example:
     ```bash
     f="${TMPDIR:-/tmp}/spm-bridge.mjs"; curl -fsSo "$f" http://192.168.0.34:3000/spm-bridge.mjs && node "$f" --server http://192.168.0.34:3000 --code ABCD-EFGH
     ```
  4. While the bridge window is open, prompts you generate in that browser run on **your PC's CLI, with your account's tokens**. Press Ctrl+C when you are done.

  The command saves the bridge to your temp folder and runs it only if the download succeeded. You can also create the code on your phone and run the command on your PC; prompts you generate on the phone then run on your PC's CLI.

The bridge (`public/spm-bridge.mjs`) is a single dependency-free file. It only connects outward to the
server, so you don't need to open a port on your PC.

## Use it as an agent skill (Claude Code, Codex, Gemini CLI)

You can also use it straight from your terminal AI agent, without the web page. Install the
`super-prompt-maker` skill, then ask as usual, e.g. "improve this prompt for Claude: …". The agent picks
up the skill and writes prompts tuned for each service.

```bash
node scripts/install-skill.mjs                    # every CLI whose settings folder exists on this PC
node scripts/install-skill.mjs --gemini           # only the CLIs you name (--claude / --codex / --gemini)
node scripts/install-skill.mjs --project <folder> # one project only
node scripts/install-skill.mjs --uninstall        # remove (same flags pick the targets)
```

| CLI | Installed to | Call it directly |
|---|---|---|
| Claude Code | `~/.claude/skills/super-prompt-maker` | `/super-prompt-maker` |
| Codex | `~/.agents/skills/super-prompt-maker` | `$super-prompt-maker` |
| Gemini CLI, Antigravity CLI | `~/.gemini/skills/super-prompt-maker` (Gemini CLI also reads `~/.agents/skills`) | check with `/skills list` |

- The skill's `scripts/spm.mjs` prints the same brief the web service uses (per-service guides, rules, the three-variant plan), and the agent writes the prompts from it. Only service ids go on the command line, never your own text.
- One service gets three variants; two to four services get one each. Each comes with a title, the prompt to copy and a one-line "why it works".
- The installed copy carries the engine from `lib/`, so it works without the repository. Rerun the installer after you update the repository.
- Agents pick it up in new sessions. Needs Node.js 18 or later.
- Verified with real Claude Code and Codex (`npm run test:cli`). Gemini CLI and Antigravity CLI are not on the test PC: the installer uses the skill folders their docs list, but no run was tried.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` to keep it on this PC only (the LAN addresses are then not printed). |
| `ALLOWED_HOSTS` | (none) | Extra host names to accept besides `localhost` and this PC's IPs, comma-separated, e.g. `myhost.local` |
| `SPM_DATA_DIR` | `data/users` | User data folder; used by the tests |
| `SPM_GEN_LIMIT` | `30` | Generation requests one visitor may send per minute |
| `SPM_BRIDGE_ONLINE_MS` | `45000` | A bridge silent for this long counts as disconnected; tests shorten it |

In Windows PowerShell, set them like `$env:PORT=3001; node server.mjs`.

## Security design

- **Fixed CLI runs:** The bridge and the local runner run only `claude`, `codex` and `gemini`, with **fixed arguments**. Prompt text goes through stdin only, and each run uses a fresh empty temp folder as its working directory.
  - Claude: `-p --tools "" --strict-mcp-config --no-session-persistence --safe-mode` (text only, no tools or MCP; `--safe-mode` also skips your hooks, plugins, skills and CLAUDE.md)
  - Codex: `exec -s read-only --ephemeral --ignore-user-config --skip-git-repo-check -c model_reasoning_effort=medium --disable shell_tool --disable unified_exec …` (text only: command execution, browser and computer-use tools are all off. `--ignore-user-config` skips your whole `config.toml`, so besides MCP servers and hooks it also ignores any model or provider you set there and uses the default model; your login still works)
  - Gemini: non-interactive stdin mode. Only the fresh, empty temp folder is trusted, for that run only (`GEMINI_CLI_TRUST_WORKSPACE`). No tool-disabling flags are set for Gemini yet, and it is untested against a real Gemini CLI. Tools that need approval are denied in non-interactive mode, but read tools may still work, so connect only to servers you trust.
  - An older Claude Code without `--safe-mode` is re-run without that one flag (tools and MCP stay off). An older Codex without `--ignore-user-config` is refused with an update message. A feature name an older Codex doesn't know is dropped from the disable list and the run is retried.
- **Server PC CLIs:** Only loopback (`127.0.0.1`) requests may use them, and loopback requests carrying proxy headers such as `X-Forwarded-For` are refused. Behind a reverse proxy or tunnel (cloudflared, Tailscale serve, …) every visitor looks like loopback; if such a tool doesn't add those headers, the server owner's account would be exposed, so don't publish this service that way.
- **Request checks:**
  - Browser API calls must be same-origin JSON (CSRF protection).
  - Only requests addressed to `localhost`, this PC's IPs or `ALLOWED_HOSTS` are accepted (DNS-rebinding protection).
- **Bridge auth:** Pairing codes are single-use and expire after 10 minutes; creating codes and pairing are limited to 20 per minute. Each browser (cookie) gets its own bridge token.
- **Framing:** Other sites can't put this page in a frame (`X-Frame-Options: DENY`).
- **Timeouts:** A CLI run is killed with its whole process tree after 360 s (the whole process group on macOS/Linux). The bridge sends a heartbeat every 20 s while generating. If none arrives for 45 s (bridge window closed, PC asleep), the running generation fails right away. The bridge retries posting a finished result.
- **Abuse limits:** 30 generation requests per minute per visitor (IP). At most 40 open long-polls per visitor and one per bridge. 1,000 library items and 500 history entries per user. A failed user-file write is logged and never stops the server. A corrupt user file is kept as `.corrupt-<time>` instead of being overwritten.
- **Network and cookie:** Server and bridge talk over unencrypted HTTP inside your network, and the bridge file is downloaded over HTTP too. A single cookie identifies each user, so someone who can sniff the network could take your cookie, read your history and send generations to your bridge. Other web apps on the same PC can also overwrite this cookie. Don't use this on untrusted networks such as public Wi-Fi.
- **Trust boundary:** The bridge runs prompts the server sends on your CLI, and the tokens come from your account. Claude and Codex run text-only with no tools, but nothing stops a server operator from choosing what prompts to send. Connect a bridge **only to servers you trust**.
- **User data:** User data lives in `data/users/<cookie-id>.json` and is git-ignored. Clearing cookies loses access to that history, so use **export** if you need a backup.

## Tests

```bash
npm test            # 40 tests, no tokens, about 3 s
npm run test:cli    # real Claude/Codex generation and skill runs (spends tokens, about 3-4 min)
```

- `npm test` runs engine unit tests, API tests against a real server, and agent-skill tests (brief script, SKILL.md, installer). The API tests cover history, library, security checks (cookie validation, server-PC CLI refused to proxied requests, model names, rate limits), the bridge flow (re-pairing, repeated results, results from another bridge, unpairing, a bridge that goes silent), failed writes and corrupt files. Tests use temporary folders only.
- `npm run test:cli` needs logged-in CLIs. Limit it to one CLI with e.g. `SPM_CLI_PROVIDERS=codex`. The skill check installs the skill into a throwaway project and confirms that the real CLI, given only a plain request, picks up the skill and writes three prompts.

Measured generation times on the afternoon of 2026-11-02, with several runs in parallel:

| Task | Claude | Codex |
|---|---|---|
| 3 prompts | about 2 min | about 1 min |
| Enhance for 2 services | about 1 min | about 30 s |

## Project layout

```
server.mjs              HTTP server, users/history/library, bridge pairing, job queue
lib/catalog.mjs         Per-service prompting guides; role/task/goal option lists
lib/engine.mjs          Meta-prompt builder, AI JSON parser, offline template engine
public/spm-bridge.mjs   CLI runner (shared by server and bridge) + bridge client
public/                 Frontend (index.html, app.js, styles.css, fonts/)
skills/super-prompt-maker/  Agent skill (SKILL.md, scripts/spm.mjs)
scripts/install-skill.mjs   Skill installer (Claude Code, Codex, Gemini CLI)
tests/                  node:test suites (engine, server, skill, real CLI)
docs/code-analysis.md   Code review and verification record
AGENTS.md               Working rules for AI coding agents
```

## Troubleshooting

- **"OAuth session expired" or "Not logged in":** run `claude auth login` (or the matching CLI's login) in a terminal. The Claude desktop app's login is separate from the terminal CLI's login.
- **Engine buttons are disabled:** this PC has no CLI, or no bridge is connected. Check the **AI 연결** tab.
- **"허용되지 않은 호스트 이름" (421):** you connected using a name other than an IP or `localhost`. Add it to `ALLOWED_HOSTS`.
- **Other devices can't connect:** if the server PC's Wi-Fi profile is Public, the firewall blocks them. Switch it to Private and allow Node.js on private networks. Check that both devices are on the same Wi-Fi.
- **"포트 3000을(를) 이미 다른 프로그램이 쓰고 있습니다" (port in use):** check whether the server is already running, or use another port: `$env:PORT=3001; node server.mjs` (macOS/Linux: `PORT=3001 node server.mjs`).
- **Yellow [ ] parts in results:** information the AI doesn't know (company name, price, date…) left blank. Replace them with your own before pasting.
- **Generation is slow:** 3 prompts usually take 1–3 minutes. Use the **built-in engine** for instant results.

## Known limitations

- The Gemini CLI path (both the web service's generation engine and the agent skill) has not been tested against a real Gemini CLI yet.
- Real second-PC access and real phones are unverified. These were simulated on one PC and with browser viewport emulation.
- There is no model picker in the UI yet. Each CLI's default model is used.

## License

- Font: [Paperlogy](https://freesentation.blog/paperlogyfont), SIL Open Font License 1.1 ([public/fonts/OFL.txt](public/fonts/OFL.txt))
- Project code: no license chosen yet.
