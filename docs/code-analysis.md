# Code Analysis — Super Prompt Maker

## Update log

- 2026-11-02 00:57 (Asia/Seoul): first review (high effort, whole project) and fixes applied. Author: Claude Code (Opus 5.5).
- 2026-11-02, after the 01:00 pause (Asia/Seoul): verified fixes 1 and 2 with fault injection. Added an automated test suite (`npm test`, 16 tests, all passing). Added the `SPM_DATA_DIR` override so tests never touch real data. Author: Claude Code (Opus 5.5).
- 2026-11-02 ~01:10–01:25 (Asia/Seoul): real CLI testing, approved by the user to spend tokens. Claude Code CLI is 2.1.316 and codex-cli is 0.166.0.
  - Added an opt-in real-CLI suite (`npm run test:cli`).
  - All real runs pass.
  - Fixed the phone/tablet layout.
  - Raised the CLI timeouts.
  - Moved the shared test helpers into `tests/helpers.mjs`.
  - Author: Claude Code (Opus 5.5).

## Scope and baseline

- Scope: every source file. That is `server.mjs`, `lib/catalog.mjs`, `lib/engine.mjs`, `public/spm-bridge.mjs`, `public/app.js`, `public/index.html` and `public/styles.css`.
- Baseline: there is no git repository and so no commit hash. The working tree was the initial implementation built in the same session (2026-11-02, 00:23–00:37 KST), plus later fixes.
- Purpose: find bugs and security problems and fix them before the 01:00 deadline.
- Environment: Windows 11, Node v24.22.1, Claude Code CLI 2.1.310 (logged in), codex-cli 0.164.0. Gemini CLI is not installed.

## Architecture summary

The server is a zero-dependency Node HTTP server (`server.mjs`). Each browser gets a user identity from an `spm_uid` cookie. History and library data are stored per user in `data/users/<uid>.json`.

Generation requests become jobs, and the browser long-polls `/api/jobs/:id` for the result. A job runs on one of three paths:

1. **Template**: offline template engine in `lib/engine.mjs`.
2. **Local**: runs the server PC's CLI. Allowed for loopback requests only.
3. **Bridge**: the visitor's own PC runs `spm-bridge.mjs`. The bridge pairs with a 10-minute one-time code, long-polls `/api/bridge/poll`, runs the whitelisted CLI and posts the output to `/api/bridge/result`.

## Findings and fixes (this session)

| # | Severity | File | Finding | Status |
|---|---|---|---|---|
| 1 | High | `public/spm-bridge.mjs` `run()` | On timeout, `child.kill()` killed only the `cmd.exe` wrapper for `.cmd` shims such as codex. The real CLI kept running and spending tokens. | Fixed: on Windows, `taskkill /T /F` kills the whole process tree. |
| 2 | High | `public/spm-bridge.mjs` `api()` | The bridge's fetch had no timeout. After a half-open connection (sleep or Wi-Fi drop), the bridge hung forever. | Fixed: `AbortSignal.timeout(45000)`. The existing retry loop then reconnects. |
| 3 | Medium | `server.mjs` bridge poll `next()` | A job could be dequeued onto a poll response that was already closed. The job was lost and failed only after the 5-minute timeout. | Fixed: the job stays queued if the response is closed. |
| 4 | Medium | `server.mjs` `loadUser()` | Every request without a cookie cached a new empty user in memory forever, so memory grew without bound. | Fixed: unsaved users live in a separate map capped at 1,000 entries and are promoted on the first save. |
| 5 | Low | `server.mjs` `saveHistory()` | History titles in option mode showed raw IDs (`marketer · write`). | Fixed: titles use the Korean labels (`마케터 · 글쓰기`). |

Fixes made earlier in the same session, during the build:

- `where.exe` garbled the non-ASCII user folder, so the server walks PATH in Node instead.
- Claude Code session variables leaked into the child `claude` process (`cliEnv()`).
- A non-zero CLI exit code was treated as success.
- `hidden` elements stayed visible because of a CSS override.
- Long-poll waits now detect disconnects on `res` 'close' instead of `req` 'close', and a poll can no longer clear a newer poll's waiter.
- Host-header allowlist against DNS rebinding.

## Remaining risks and open questions

- **Bridge trust model.** The server operator chooses the prompts a visitor's bridge runs. Codex runs with `-s read-only`, but it can still *read* files on the visitor's PC. Claude runs with `--tools ""`, so it has no file access. Visitors should connect a bridge only to a server they trust. This is documented in the README.
- **No authentication beyond the cookie.** Anyone on the LAN can use the service. Clearing cookies loses access to that user's history; export is the only backup.
- **Gemini path is unverified.** It uses non-interactive stdin with no flags. Behavior differs between Gemini CLI versions.
- **Data loss window.** User data is written with a 300 ms debounce, so a crash inside that window loses the last change.
- **Test gaps.** No automated test covers:
  - the remote refusal of the local CLI (it needs a real LAN IP);
  - the UI (`public/app.js`);
  - real CLI runs. These are covered only by the opt-in `npm run test:cli`, which needs logged-in CLIs and spends tokens.
- **Generation speed.** 3 full prompts take about 1–3 minutes, depending on the user's default model and load. There is no model picker in the UI yet. The server already accepts a `model` field.

## Verification performed (2026-11-02, this session)

- `node --check` passes on every JS/MJS file.
- API script against a running server:
  - Template generation for a new user is saved and the title is `마케터 · 글쓰기`. History persists.
  - Bridge pairing connects after the fixes.
  - 50 cookie-less requests created no data files and the server stayed healthy.
- Earlier in the session:
  - Codex generation verified locally and through the bridge.
  - Claude CLI generation verified in the UI after login: 3 service-specific prompts in about 94 s.
  - Rebinding host returns 421, cross-origin returns 403, path traversal returns 404, and a non-loopback request for the local CLI is refused.
- **Fault injection after the pause:**
  - **Fix 1, process-tree kill.** A fake `codex.cmd` started a node process that never exits. It was put first on PATH and run with `runCli('codex', …, { timeoutMs: 4000 })`.
    - The hung CLI was alive during the run (pid 12220) and gone after the timeout.
    - The same fake run through the old `child.kill()` left the CLI orphaned (pid 32860, cleaned up manually). So the bug was real and the fix works.
  - **Fix 2, bridge reconnect.** A fake server accepted pairing and then never answered `/api/bridge/poll`.
    - The bridge aborted the poll at 45.3 s and polled again at 46.3 s. Result: PASS.
- **Automated suite** (`npm test` = `node --test`, 16 tests, 16 pass, about 0.8 s):
  - `tests/engine.test.mjs` covers request normalization, the meta-prompt count, JSON/fenced/prose/fallback parsing, template styles, and Korean particles.
  - `tests/server.test.mjs` starts a real server on a random port with a temporary `SPM_DATA_DIR`. It covers:
    - template generation, persistence and titles;
    - history favorite, search, clear and delete, and per-browser isolation;
    - library CRUD and export;
    - 403/415/421 responses and path traversal (encoded `..%2f`/`..%5c` → 403);
    - the bridge flow: single-use pair code, job delivery, result, error propagation, unpair → 401.
  - The suite found one wrong expectation in the test itself: `%2e%2e` is collapsed by URL parsing and returns 404, which is still safe. No product bug.
- **Real CLI suite** (`tests/cli.test.mjs` via `npm run test:cli`, skipped by plain `npm test`). It spends tokens. All 7 tests pass, plus a separate Codex bridge run. Durations below were measured with up to 8 CLI runs in parallel.

  | Test | Claude | Codex |
  |---|---|---|
  | Direct run answers | 8.6 s | 7.7 s |
  | Option builder via this PC → 3 prompts for the Claude target, ≥2 of 3 in XML tags | 168 s | 90 s |
  | Enhance via this PC → ChatGPT (Markdown sections) + Gemini versions, original request kept | 56 s | 55 s |
  | Real `spm-bridge.mjs` process → 3 Perplexity versions | 63 s | 69 s |

  Every generation kept the JSON contract (no raw-text fallback). Each wrote distinct Korean prompts of at least 150 characters with a title and a rationale.
- **Browser UI with real CLIs:**
  - Codex enhance (ChatGPT/Claude/Gemini).
  - Claude enhance, about 94 s.
  - Claude option builder for ChatGPT: 3 variants of 898, 2,496 and 2,019 characters, 118 s under load.
- **Issues found by real-CLI testing, and fixes:**
  - Under parallel load a 3-prompt Claude run took 168 s. The CLI timeout (240 s) and bridge job timeout (300 s) left too little margin, so they were raised to 360 s and 420 s. The bridge timeout stays longer, so the CLI's own error message reaches the user. The UI hint "보통 20~90초" was wrong and now reads "보통 1~3분".
  - Narrow screens (≤900 px / ≤480 px):
    - The header wrapped "Super Prompt Maker" onto three lines.
    - Results appeared under the long form with no scroll, so a phone user saw no progress.
    - The form stayed sticky.
    - Result-card titles shrank to "C…".
    - Fixed with a wrapping header, non-sticky form, scroll-to-results on narrow screens, and the title on its own row.
    - Verified at 375×812: no horizontal overflow, results visible after submit, full title (310 px). Desktop at 1280 px is unchanged.
- **Not verified:**
  - The Gemini CLI (not installed).
  - A real second PC on the LAN.
  - Real phones: only browser viewport emulation was used.
