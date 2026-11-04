# AGENTS.md — Super Prompt Maker

Instructions for AI coding agents (Claude Code, Codex, OpenCode, …) working in this repository.

## What this is

A zero-dependency Node.js (>=18) local web service that turns a user's prompt, or a set of selected
options, into prompts optimized for specific AI services (ChatGPT, Claude, Gemini, Perplexity, Grok,
DeepSeek, Copilot, CLOVA X, image models). Generation runs on the **visitor's own** Claude / Codex /
Gemini CLI account, never the server owner's, except when the visitor is on the server PC itself.

- Run: `node server.mjs` (or `start.bat`), then open http://localhost:3000. `PORT` / `HOST` env vars override the defaults.
- The same engine also ships as an agent skill for Claude Code, Codex and Gemini CLI: `node scripts/install-skill.mjs`.
- Product and user docs: `README.md` (Korean).
- UI language: Korean. Font: Paperlogy, self-hosted in `public/fonts/`.

## Layout

| Path | Role |
|---|---|
| `server.mjs` | HTTP server, cookie users, history/library JSON store (`data/users/`), bridge pairing, job queue with long-polling |
| `lib/catalog.mjs` | Target services and their prompting guides; role/task/goal/tone/format option lists |
| `lib/engine.mjs` | Meta-prompt builder, AI JSON output parser, offline template engine |
| `public/spm-bridge.mjs` | CLI runner (`detectClis`, `runCli`), imported by the server **and** run standalone on visitors' PCs as the bridge |
| `public/index.html`, `app.js`, `styles.css` | Vanilla JS single-page frontend, no build step |
| `skills/super-prompt-maker/` | Agent skill for Claude Code, Codex and Gemini CLI: `SKILL.md` plus `scripts/spm.mjs`, which prints the brief (`buildMetaPrompt(req, { forAgent: true })`) |
| `scripts/install-skill.mjs` | Copies the skill, plus `lib/catalog.mjs` and `lib/engine.mjs`, into each CLI's skill folder (`~/.claude/skills`, `~/.agents/skills`, `~/.gemini/skills`, or a project's `.claude/skills` and `.agents/skills`) |

## Invariants — do not break

- No npm dependencies. Visitors download `spm-bridge.mjs` as a single file and run it with plain `node`.
- The bridge and the local runner execute only `claude`, `codex`, `gemini` with fixed arguments. Prompt text goes through stdin only, never through argv or a shell string. Claude runs with `--tools "" --safe-mode`, Codex with `-s read-only --ignore-user-config` plus `--disable` for its shell, exec, browser, computer-use and apps tools (`CODEX_DISABLED`), so both are text-only and the visitor's own hooks, plugins and MCP servers never run. If Codex can't be isolated (too old for `--ignore-user-config`) the run is refused, never retried without isolation. Retries on argument errors only trust stderr printed before any model run. Model names never start with `-` (`MODEL_RE`).
- Bridge timing lives in `public/spm-bridge.mjs` (`CLI_TIMEOUT_MS`, `HEARTBEAT_MS`, `FETCH_TIMEOUT_MS`); `server.mjs` derives its job timeout, online window and poll hold from them. Change them there, not in the server.
- The server-PC CLI (`via: "local"`) is allowed only for loopback requests. Remote visitors must pair a bridge.
- Browser API calls must stay same-origin JSON (the `sameOrigin` check and the content-type check).
- Every request must pass `hostAllowed` (localhost, this PC's interface IPs, `ALLOWED_HOSTS`). This blocks DNS rebinding.
- On Windows, resolve CLIs by walking PATH in Node (`resolveCommand`). `where.exe` mangles non-ASCII user folders.
- When the server is started from inside a Claude Code session, `cliEnv()` strips that session's `CLAUDE_CODE_*` / `CLAUDECODE` / `ANTHROPIC_BASE_URL` variables so that the child `claude` uses the user's own login.
- The agent skill has no copy of the guides or rules: `spm.mjs` imports `lib/` (the repository's, or the copy the installer bundles), so the web service and the skill always share one engine. Only ids go on `spm.mjs`'s command line; the user's text stays in the agent's conversation. The target table in `SKILL.md` must list exactly the catalog's target ids (a test checks this). The installer never overwrites or deletes a folder whose `SKILL.md` is not `name: super-prompt-maker`.
- Never commit `data/` (user histories).

## Verification

Run the automated suite (zero dependencies, `node:test`). The server tests start their own server
on a random port with a temporary `SPM_DATA_DIR`, so they never touch `data/`.

```bash
npm test
```

Real Claude/Codex runs live in `tests/cli.test.mjs`, including the agent skill used from a plain request
in a throwaway project. Plain `npm test` skips them. They spend tokens and need logged-in CLIs, so run
them only after a change to the runner, bridge, meta-prompt, parser or skill, and only when token use is
acceptable:

```bash
npm run test:cli                            # claude and codex
SPM_CLI_PROVIDERS=codex npm run test:cli    # one provider
```

Shared test helpers (throwaway server, cookie client, job waiter) are in `tests/helpers.mjs`.
No suite covers the UI. After a UI change, check it in a browser at desktop width and at phone width
(375 px).

## Analysis reports

Follow the shared analysis policy: read this file and the existing report first, then refresh the
report in place and add a dated entry to its update log. Canonical paths:

- Code analysis / code review: `docs/code-analysis.md` (exists; last updated 2026-11-04, agent skill added)
- Service analysis: `docs/service-analysis.md` (English; not written yet)

Record any new canonical report path in this section.
