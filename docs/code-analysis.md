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
- 2026-11-02 ~12:30–14:30 (Asia/Seoul): two-round multi-critic review, requested by the user.
  - In each round, five subagents with different angles criticized the code independently. The main session re-verified every claim against the code before accepting it, and fixed every finding it accepted.
  - Round 1: 40 findings; 39 accepted, 1 rejected. Round 2: 38 findings; all accepted, 3 as documentation only.
  - `npm test` grew from 16 to 35 tests. All 35 pass.
  - Author: Claude Code (Opus 5.5).
  - See [Two-round critical review](#two-round-critical-review-2026-11-02-afternoon).
- 2026-11-04 ~11:20–12:40 (Asia/Seoul): added the agent skill for Claude Code, Codex and Gemini CLI, requested by the user ("우리 기능 CLI 스킬로도 만들자 … 3개 다 지원").
  - New: `skills/super-prompt-maker/`, `scripts/install-skill.mjs`, `tests/skill.test.mjs`. Changed: `buildMetaPrompt` gained a `forAgent` option, `cliEnv` is exported, and `tests/cli.test.mjs` gained real skill runs.
  - `npm test`: 40/40. `npm run test:cli`: 9/9, including the skill with real Claude and Codex.
  - Author: Claude Code (Opus 5.5).
  - See [Agent skill](#agent-skill-2026-11-04).

## Scope and baseline

- **Agent skill addition (2026-11-04):** still on `dc92e9d`. The two-round review changes were never committed, so the skill sits on top of them. Working tree at the end: the 15 modified files from the review (some touched again) plus the new `skills/`, `scripts/` and `tests/skill.test.mjs`. Nothing is committed or pushed.

- **Current review (afternoon):** every source, test and doc file.
  - Baseline: git commit `dc92e9d` on `main` (pushed to `himangga01/super-prompt-maker-ai`). The working tree was clean before the review.
  - All changes below are **uncommitted** working-tree changes on top of `dc92e9d`: 14 files, about +1,340/−400 lines.
- **First review (00:57):** baseline had no git repository. It was the initial implementation built 00:23–00:37 KST, plus fixes.
- **Purpose:** find defects from several independent viewpoints, verify each claim, and fix the valid ones. Repeat the process twice.
- **Environment:**
  - Windows 11, Node v24.22.1, Claude Code CLI 2.1.316 and codex-cli 0.166.0, both logged in.
  - Gemini CLI is not installed.
  - There is no macOS or Linux machine.

## Architecture summary

The server is a zero-dependency Node HTTP server (`server.mjs`).

**Users and storage.** Each browser gets a user identity from an `spm_uid` cookie (32 hex characters, validated on every route). History and library data are stored per user in `data/users/<uid>.json`. Storage follows these rules:

- one disk read per user at a time (shared in-flight loads);
- a per-user write chain with unique temp files and retries on Windows file locks;
- a corrupt file is renamed to `.corrupt-<ts>`, not overwritten;
- idle users are evicted from memory after one hour.

**Jobs.** Generation requests become jobs. The browser long-polls `/api/jobs/:id`, with at most 40 open long-polls per client. A job runs on one of three paths:

1. **Template:** the offline template engine in `lib/engine.mjs`. It has per-task hints (`TASK_HINTS`), task detection for enhance mode (`detectTask`), and its own version names for image and search targets.
2. **Local:** runs the server PC's CLI. It is allowed only for loopback requests that carry no proxy headers (`isServerPcUser`).
3. **Bridge:** the visitor's own PC runs `spm-bridge.mjs`:
   - It pairs with a 10-minute one-time code.
   - It long-polls `/api/bridge/poll`, with one parked poll per bridge; a newer poll releases the older one.
   - It runs the whitelisted CLI with fixed arguments and heartbeats every 20 s while the CLI runs.
   - It posts the output to `/api/bridge/result`, with retries.
   - The server fails a running bridge job once the bridge has been silent for 45 s. It refuses late or repeated results with 409.

**CLI isolation** (`public/spm-bridge.mjs` `argsFor`):

- **Claude:** `--tools "" --strict-mcp-config --safe-mode` (no tools, no MCP, no hooks, plugins or CLAUDE.md).
- **Codex:** `-s read-only --ignore-user-config --disable shell_tool --disable unified_exec --disable browser_use --disable browser_use_external --disable computer_use --disable in_app_browser --disable apps` (text only).
- **Gemini:** headless stdin with `GEMINI_CLI_TRUST_WORKSPACE=true` for the empty temp folder. This path is untested.

**Shared constants.** Timing constants (`CLI_TIMEOUT_MS`, `HEARTBEAT_MS`, `FETCH_TIMEOUT_MS`) live in the bridge, and the server derives its own limits from them.

**Agent skill.** `skills/super-prompt-maker/` gives the same engine to terminal agents without the server. The agent itself writes the prompts; `scripts/spm.mjs brief` prints `buildMetaPrompt(req, { forAgent: true })`, and `scripts/install-skill.mjs` copies the skill and `lib/` into each CLI's skill folder. See [Agent skill](#agent-skill-2026-11-04).

## Agent skill (2026-11-04)

### Design

- **The agent is the engine.** Inside Claude Code, Codex or Gemini CLI the model is already running, so the skill does not call a CLI or the server. `spm.mjs brief --target <id>… --lang ko|en --purpose <id>` prints the brief and the agent follows it.
- **One source of truth.** The brief comes from `buildMetaPrompt(req, { forAgent: true })` in `lib/engine.mjs` (`lib/engine.mjs:79`). It has the same target guides, variant plan and rules as the web service. It differs only where the context differs:
  - it points at the conversation instead of embedding `<user_prompt>`;
  - it drops "do not use tools";
  - it asks for Markdown (heading, a `text` code block and a bold why line per prompt) instead of JSON;
  - it lets the user ask for fewer variants.
  - The default (web) output is unchanged, and a test checks this.
- **No user text on the command line.** Only ids go to `spm.mjs`. This avoids shell quoting and the Windows PowerShell 5.1 pipe encoding, which turns Hangul into `?`, and keeps user text out of a shell entirely.
- **Self-contained installs.** `spm.mjs` loads `../lib` when present (the installer copies `catalog.mjs` and `engine.mjs` there) and otherwise falls back to the repository's `lib/` (`skills/super-prompt-maker/scripts/spm.mjs:17`). The installer runs the installed copy once as a self-check.
- **Ownership.** The installer refuses to overwrite or delete a folder of the same name whose `SKILL.md` is not `name: super-prompt-maker` (`scripts/install-skill.mjs:73`).

### Where each CLI reads skills (checked 2026-11-04)

| CLI | User scope | Project scope | Source |
|---|---|---|---|
| Claude Code 2.1.316 | `~/.claude/skills` (`CLAUDE_CONFIG_DIR` honoured) | `.claude/skills` | verified by the real run |
| Codex 0.166.0 | `~/.agents/skills` | `.agents/skills` from cwd up to the repo root | [Codex skills docs](https://learn.chatgpt.com/docs/build-skills); project scope verified by the real run |
| Gemini CLI | `~/.gemini/skills` or `~/.agents/skills` | `.gemini/skills` or `.agents/skills` | [Gemini CLI skills docs](https://geminicli.com/docs/cli/skills/) |
| Antigravity CLI (`agy`) | `~/.gemini/skills`, `~/.gemini/config/skills`, `~/.gemini/antigravity-cli/skills` | `.agents/skills` | [Antigravity skills docs](https://antigravity.google/docs/skills) |

The Gemini CLI page says it "was replaced by Antigravity CLI on June 18th, 2026" for unpaid-tier and Google One users. That is why `~/.gemini/skills` is the Gemini install target: both CLIs read it. The installer picks each CLI by its settings folder (`~/.claude`, `~/.codex` or `CODEX_HOME`, `~/.gemini`) unless flags name them.

### Findings from real runs, and what changed

| # | Observed (real CLI) | Change |
|---|---|---|
| S1 | Codex, asked for "a midjourney prompt", wrote one prompt with no heading or why line. It read "if the user asked for fewer, keep only those" as covering "a prompt". | The brief now says the variants are alternatives to compare and to write all unless the user asks for a number such as "just one"; `SKILL.md` step 3 says the same. A rerun produced three variants. |
| S2 | Codex dropped the bold why line in 2 of 3 runs. | The contract now explains why the line matters (it tells the user what to keep when editing). A rerun kept a why sentence on every prompt. |
| S3 | Codex still uses its own markup: bold titles instead of `###`, and the why sentence without the bold label. | Accepted: the content structure is the same. The real-CLI test checks content (three `text` blocks, Korean, XML for Claude, the original request kept), not exact markup. |
| S4 | Claude answered an English image request with Korean notes; the prompts themselves were English. | No change: the user's global `CLAUDE.md` says to reply in Korean, which outranks the skill. |
| S5 | A plain "write the press release" request did not trigger the skill (Claude wrote the press release itself). | None needed: the description says "not when they want the task itself done". |

### Remaining skill risks

- **Gemini CLI and Antigravity CLI are untested.** Neither is installed here. The install paths come from their docs only. Gemini also asks for consent before activating a skill.
- **Installed copies go stale.** They don't follow repository updates until the installer is rerun. Documented in both READMEs.
- **Codex is slower with this user's setup.** Its runs first read the user's own `superpowers` plugin skills before this one. Runs took about 55–105 s, against 26–100 s for Claude.
- **Needs Node.js 18+ on the agent's machine.** `SKILL.md` says how to degrade without it: write the prompts from the stated per-service conventions.

## Two-round critical review (2026-11-02 afternoon)

### Method

1. Five `general-purpose` subagents ran in parallel, each with one angle, and each was read-only on the project. They were told:
   - never to run real CLIs with prompts;
   - to use only throwaway servers on random ports (never port 3000);
   - to report findings with `file:line`, a failure scenario, evidence and a proposed fix.
2. The main session re-verified every finding. It read the code, reproduced the claim where needed, and checked external facts against the web and against `--help` output and real CLI calls.
3. Valid findings were fixed, with regression tests where possible. Some tests were mutation-checked against the old code or a deliberately broken copy.

### Round 1: security, reliability, CLI integration, prompt quality, frontend

| ID | Sev. | Finding (where) | Verification | Outcome |
|---|---|---|---|---|
| S1 | High | Bridge routes skipped `uidOk`. A raw cookie reached `loadUser`, which read a `.json` file outside the data folder and grew memory without bound (`server.mjs`). | Code read. The critic reproduced memory going from 69 MB to 654 MB. | Fixed. The uid is validated on every route, and bridge routes never load a user. Tested. |
| S2/R1 | High | An error in the debounced save crashed the whole server. Triggers: EPERM on rename, mkdir ENOENT, `writeFile(undefined)` for an evicted user. | Reproduced by the critic. Regression test fails on the old code. | Fixed. Write chain, try/catch with log, unique tmp file, retries, `unhandledRejection` logger. |
| R2 | Med-High | Concurrent first loads of the same user lost writes, though the client got 200. | Critic: 5 of 6 trials. Regression test fails on the old code. | Fixed: in-flight load map. |
| R3 | Medium | Any read or parse error was treated as a new user, and the file was overwritten. | Code read. | Fixed. Only ENOENT means a new user. A corrupt file is kept as `.corrupt-<ts>`. Other read errors return 503. |
| R4 | Medium | Finished jobs could change state again. Duplicate results created two history entries. Queue time counted against the timeout. | Reproduced by the critic. | Fixed. 409 for finished jobs, timeout re-armed at pickup, the queue skips finished jobs. Tested. |
| R5 | Medium | Re-pairing or unpairing left jobs orphaned. | Reproduced by the critic. | Fixed. Queued jobs are handed to the new bridge, and running jobs are failed. Tested. |
| R6/C1 | High | A bridge busy with a 1–3 minute run looked offline after 45 s, so a second generation got 409 and the UI switched to the template engine. | Reproduced by the critic (51 s → `connected=false`). | Fixed. The bridge sends a heartbeat. The UI keeps the user's chosen engine (`state.chosen`). |
| R7 | Medium | A malformed cookie (e.g. `progress=100%`) caused a 500 on every request. | Reproduced by the critic. | Fixed: `getCookie` with try/catch. Tested. |
| S3/R8 | Med | Unbounded growth: cookieless users, library size, `historyId` size, pair codes. | Reproduced by the critic. | Fixed. Caps, `historyId` validation, rate limit, idle eviction. |
| S4 | Medium | The bridge one-liner downloads and runs over plain HTTP. | Reasoning. | Partly fixed. The command downloads to the temp folder and runs only if the download succeeded. The README warns about the network. No TLS. |
| S5 | Medium | A reverse proxy or tunnel makes every visitor look like loopback. | Reasoning. | Fixed: requests with proxy headers are not treated as the server PC. Documented. Tested. |
| S6 | Medium | `requestTimeout = 0` allowed slow-body socket exhaustion. | Code read. | Fixed: 120 s (long-polls are unaffected). |
| S7 | Low | `MODEL_RE` allowed a leading `-`. | Code read. | Fixed: shared `MODEL_RE` with `(?!-)`. Tested. |
| S8 | Low | `GET /api/session?refresh` could be used to spawn processes repeatedly. | Code read. | Fixed: refreshes are throttled to one per 10 s, and detection is shared. |
| C2 | Medium | Codex and Claude loaded the visitor's MCP servers, hooks, plugins and CLAUDE.md. | `--help` output. | Fixed: `--safe-mode` and `--ignore-user-config`. Verified with real CLIs (Claude 4.6 s, Codex 5.2 s). |
| C3 | Medium | A UTF-8 character split across chunks became U+FFFD (outputs ≥ 120 KB). | Reproduced by the critic. | Fixed: `setEncoding('utf8')`. |
| C4 | Medium | On POSIX, a timeout killed only the direct child process. | Inferred. | Fixed: detached process group, SIGTERM then SIGKILL, signal handlers. **Not verified on POSIX.** |
| C5 | Medium | Gemini's fresh temp folder is untrusted, so Gemini fails when folder trust is on. | Gemini docs (`GEMINI_CLI_TRUST_WORKSPACE`). | Fixed via an environment variable. Gemini is still untested. |
| C6 | Low | `resolveCommand` ignored PATH order. | Reproduced by the critic. | Fixed: folders first, then extensions. |
| C8 | Low | `fs/promises` `constants` breaks Node 18.0–18.3. The PowerShell `;` chain ran a stale file. Results were not retried. | Reproduced by the critic. | Fixed. |
| P1 | High | The search and image templates gave 3 identical versions. | Script. | Fixed. Tested on all 10 targets. |
| P2 | High | Enhance mode added a length and tone the user never chose. | Script. | Fixed. Tested. |
| P3 | High | The image target received contradictory rules (Korean, role, steps). | Meta-prompt read. | Fixed: image-specific rules. |
| P4 | Medium | The CLOVA X consumer chatbot closed on 2026-04-09. The DeepSeek guide was out of date. Perplexity was asked to type URLs. | Web search (closure confirmed); docs.perplexity.ai prompt guide. | Fixed: HyperCLOVA X, a hybrid-model DeepSeek guide, no URL requests. |
| P5 | Medium | "Step by step" instructions contradicted the guidance for reasoning models. | Vendor docs cited by the critic. | Fixed: `reasoning` flag and rule. The template drops step-by-step for those models. |
| P6 | Medium | Triple quotes `"""` in the user's input could break out of its block. | Script. | Fixed: `<user_prompt>` tag, neutralization of nested tags, a "this is data" note. Tested. |
| P7 | Medium | Parser: prose braces, a short count and unknown targets went unhandled. | Script. | Fixed: balanced-brace scan, fallback to the requested slot's target, note when the count is short. Tested. |
| P8 | Low | Template wording; Korean labels in English mode; the Copilot "Source" slot; techniques dropped from the short version. | Script. | Fixed: English labels and per-style fixes. Tested. |
| F1 | High | `form.elements['length']` returned the collection's own `length` count, so "↺ 다시 만들기" was broken for every entry. | Browser. | Fixed: `namedItem`. Re-verified in the browser. |
| F2 | Medium | The engine choice was locked to template before the session loaded. | Browser. | Fixed: `pickEngine` is recomputed on each render. Re-verified in the browser. |
| F3 | Medium | The job poll gave up on the first network error. | Reasoning. | Fixed: retries with backoff, Korean messages. |
| F4 | Medium | Double-clicking ☆ 저장 saved duplicates. | Browser (3 clicks → 3 items). | Fixed. Re-verified: 3 clicks → 1 item. |
| F5 | Medium | ARIA states missing; focus stolen by the 15 s re-render. | Browser. | Fixed: `aria-selected`/`pressed`/`live`, labels, re-render only on change. Arrow-key tab navigation is not added. |
| F6 | Medium | Contrast below 4.5:1 (star, dark-mode fills). | Computed. | Fixed. Every changed colour is ≥ 4.5:1 (computed). |
| F7 | Medium | Phone layout: hidden tabs, squeezed history titles, long strings overflowing, sticky form too tall, iOS zoom. | Browser. | Fixed. Re-verified at 375 px: no overflow, all tabs visible, title 142 px. |
| F8 | Low | The copy fallback ignored the result of `execCommand`. | Reasoning. | Fixed. |
| C7 | Low | `cliEnv` strips user-set `CLAUDE_CODE_*` variables. | Code read. | **Rejected.** Stripping happens only when the process was started inside Claude Code. An allowlist could bring back the auth leak fixed earlier. |

### Round 2: regressions, red team, first-time user and docs, tests and maintainability, end-user output quality

| ID | Sev. | Finding (where) | Verification | Outcome |
|---|---|---|---|---|
| G2 | High | **Every UI DELETE returned 415**: history delete, clear, library delete, unpair. The bug predates round 1; tests always sent `body: {}`, which hid it. (`app.js` `api()`) | Code read. A test now asserts that a DELETE without a JSON content type gets 415. | Fixed: non-GET requests always send JSON. **Re-verified in the browser:** library 3 → 2, history 10 → 9. |
| G1 | High | The new brace scan was O(n²) on unclosed `{`, so a paired bridge could freeze the server. | Critic: 40k braces took 1.6 s and 100k blocked the server 8 s. Test: a 200k-brace flood now parses in < 2 s. | Fixed: lazy generator, 2 M character budget, result capped at 300 KB. |
| RT1 | High | A malicious server could make the visitor's Codex read files (the read-only sandbox still allows reads). | **Verified with real codex 0.166.0.** With tools on, Codex tried `Get-Content` on a secret file (refused here as "blocked by policy"). With tools off, 0 attempts. | Fixed: Codex runs text-only (`CODEX_DISABLED`). Gemini only documented; see the risks. |
| U1 | High | The bridge exits silently when started through a symlink. The macOS `$TMPDIR` path is under `/var`, a symlink to `/private/var`. | Critic reproduced with a Windows junction. | Fixed: compare `realpathSync` paths. **Not verified on macOS.** |
| U2 | High | Closing the bridge mid-generation left the browser spinning for 7 minutes. | Critic reproduced. | Fixed: a stale-bridge check in the job poll and a 10 s sweep. Tested with `SPM_BRIDGE_ONLINE_MS=300`. |
| RT3 | Medium | Long-polls were unmetered, so many sockets could be parked. | Critic: 25 of 25 polls held open. | Fixed: 40 long-polls per client, one poll per bridge, rate limits on pair and code, stale bridges pruned. Tested. |
| G3 | Medium | On POSIX, SIGHUP (terminal closed) orphaned the detached CLI. | Reasoning. | Fixed: SIGHUP and `exit` handlers. Not verified on POSIX. |
| G4/RT6 | Medium | The fallback regex could match the prompt echoed in stderr, re-running without isolation. An old Codex fell back unisolated. | Critic: a fake Codex was called twice. | Fixed. Only line-anchored argument errors printed before the Codex banner count. A missing `--ignore-user-config` now fails closed. An unknown feature name drops only that `--disable`. |
| G5 | Medium | The short Perplexity version dropped the user's constraints. | Script. | Fixed. Tested. |
| G6/RT4 | Low-Med | The rate limit was keyed on the socket IP, so everyone behind a local proxy shared one bucket. | Critic reproduced. | Fixed: the forwarded IP is used only for loopback requests; `SPM_GEN_LIMIT`. Tested. |
| G7 | Low-Med | `--ignore-user-config` also drops the user's model and provider settings. | `codex exec --help`. | Documented in both READMEs (trade-off kept for isolation). |
| G8 | Low | Re-pairing handed jobs to a bridge without that job's CLI. | Critic reproduced. | Fixed: such jobs are failed at hand-off. |
| RT2 | High (design) | The cookie is the only credential: it can be sniffed on plain HTTP or fixed by another app on the same host. | Critic PoC. | **Documented only.** A real fix needs HTTPS and `__Host-` cookies, which is out of scope for a zero-dependency LAN tool. |
| RT5 | Low | No clickjacking protection. | Header check. | Fixed: `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`. The preview pane still loads. |
| U3 | Medium | The firewall advice blocks visitors, because Windows marks new Wi-Fi networks as Public. | `Get-NetConnectionProfile` (critic). | README: set the profile to Private; new troubleshooting entry. |
| U4 | Medium | Port in use produced a raw English stack trace. | Critic reproduced. | Fixed: Korean `EADDRINUSE` message with the PowerShell syntax for `PORT`. |
| U5 | Low-Med | Bridge errors were raw English; no Node version check; `localhost` resolves to `::1` on Node 18. | Critic reproduced. | Fixed: Korean network errors, Node ≥ 18 check, URL check, pair command uses `127.0.0.1`. |
| U6–U8 | Low | Wrong text after a server restart; ✅ implied "logged in"; LAN URLs printed for `HOST=127.0.0.1`. | Critic reproduced. | Fixed: messages, labels, `LOGIN_CMD`, `loopbackOnly`. |
| T1 | High | 4 security guards had no test: `uidOk`, the proxy guard, the loopback-only local CLI, `MODEL_RE`. | Mutation runs by the critic. | Tests added. **Re-verified:** the `uidOk`, proxy-guard, 409 and one-poll mutations are each caught by exactly one test. |
| T2 | High/Med | Bridge lifecycle rules untested: owner check, unpair-running, job long-poll hold, heartbeat `lastSeen`. | Mutation runs by the critic. | Tests added. |
| T3/T4 | Medium | A broken flow hung the suite for 382 s. Random-port collisions. A failed start leaked the process and temp folder. | Critic reproduced. | Fixed: `waitJob` deadline, `PORT=0` with the port parsed from the log, cleanup with output on failure, `server?.stop()`. |
| T5 | Med/Low | Three tests didn't prove their names (disk write, failure log, malformed cookie). | Mutation runs by the critic. | Fixed: the disk test reads the entry back, the log test checks the message, the cookie test uses `%E0%A4%A`. |
| T6/T7/T8 | Low | Rate limit untestable; duplicated provider lists and timeouts; parser gaps. | Critic. | Fixed: `SPM_GEN_LIMIT`, `ENGINES`/`CLIS`, shared timing constants, new parser tests. |
| E1 | High | A default "use headings" format line contradicted requests like "3줄로" (in 3 lines). | Script. | Fixed: a format is added only when the user chose one or the task makes it obvious. Tested. |
| E2 | High | Offline enhance mode ignored what the user wrote. | Script. | Fixed: `detectTask`, `TASK_HINTS` (role, steps, format, placeholders), `PURPOSE_ROLES`. Tested. |
| E3 | Med-High | The 심화 (deep) variant added "alternatives" and "draft + critique" to every task. | Script. | Fixed: alternatives only for choice tasks; "최종본만 제시" (present only the final version). Tested. |
| E4/E5 | Medium | Translated-sounding Korean goal sentences; "10년 경력의 학생" (a student with 10 years' experience) as the AI role. | Script. | Fixed: rewritten sentences; the 학생 role became 튜터·학습 코치. |
| E6 | Medium | Variant hints contradicted the image and search rules. | Meta-prompt read. | Fixed: per-style variant names and hints (`STYLE_VARIANTS`); the role rule applies to chat targets only. |
| E7/E8 | Med/Low | Unfilled `[…]` placeholders were not pointed out; all offline titles were identical. | Script, browser. | Fixed: highlighted placeholders with a hint line; titles carry the topic. Re-verified in the browser. |

### Not adopted, or only partly done

- **C7:** see round 1.
- **RT2:** cookie-only identity on plain HTTP. Documented.
- **S4:** no TLS.
- **Gemini isolation:** no tool-disabling flag was added. It could not be verified without a Gemini CLI.
- **Server limits:** no `maxConnections`; the per-client long-poll cap is used instead.
- **Tab keyboard:** no arrow-key navigation between tabs.
- **Structured output:** the CLIs' `--output-schema` / `--json-schema` flags are not used.

## Findings and fixes (first review, 2026-11-02 00:57)

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

Ordered by priority.

1. **Bridge trust model.**
   - The server operator chooses the prompts a visitor's bridge runs, on the visitor's tokens.
   - Claude and Codex are now text-only, so they have no file, shell or browser tools.
   - **Gemini has no tool isolation flag yet and is untested.** Its read-only tools may still work in headless mode.
   - Visitors should pair only with servers they trust, as the README says.
2. **Cookie-only identity over plain HTTP (RT2).**
   - Anyone who can sniff the LAN, or run another web app on the same host, can take over a user's history and send generations to that user's bridge.
   - Fixing this needs HTTPS. Documented.
3. **POSIX behaviour is unverified.** This PC has no macOS or Linux machine. The items are:
   - process-group kill, SIGHUP handling;
   - the realpath main check (macOS `/var` → `/private/var`);
   - the `curl` command under zsh.
4. **Codex `--ignore-user-config` trade-off.** Users who reach models through a custom provider in `config.toml` lose it, and Codex runs on its default model. Documented.
5. **Data-loss window.** Writes are debounced by 300 ms, and there is no fsync. A crash in that window loses the last change; a torn write is now kept as `.corrupt-*`, not overwritten.
6. **Test gaps.**
   - No automated UI test; UI checks are manual in the browser pane.
   - The real-CLI suite is opt-in and spends tokens.
   - No automated test of the POSIX paths or the Gemini CLI (web engine or agent skill).
7. **No model picker in the UI.** The server and bridge accept a validated `model` field.

## Verification performed

### Agent skill (2026-11-04)

- `npm test`: **40/40 pass** in about 2.5 s. That is the 35 earlier tests plus 5 in `tests/skill.test.mjs`:
  - the brief keeps the service's guides but has no `<user_prompt>` and no JSON contract;
  - duplicate and case-insensitive ids;
  - bad arguments exit 2;
  - the web meta-prompt is unchanged;
  - `SKILL.md` frontmatter, and its target table equals `TARGETS`;
  - the installer, run in a temporary home: detection by settings folder, an explicit `--gemini`, `--project`, a self-contained copy run from outside the repository, a refusal to overwrite or delete a foreign skill, and `--uninstall`.
- `npm run test:cli`: **9/9 pass** in 207 s with real Claude Code 2.1.316 and codex-cli 0.166.0 (tokens approved by the user earlier). That is the existing 7 runner, server and bridge tests plus 2 new skill tests.
  - The skill is installed into a throwaway project with `--project`. Each CLI gets only "이 프롬프트 Claude용으로 다듬어줘: 우리 회사 신제품 무선 이어폰 런칭 보도자료 써줘".
  - The tests assert from the CLI's JSON event stream that the CLI ran `spm.mjs … brief`. They also assert three `text` blocks, Korean prompts that keep the original request, and XML tags in at least two.
  - Times: Claude 82 s, Codex 92 s.
- The assertions were also applied to the saved transcripts. They passed on the three runs that used the skill and failed on the run that did not trigger it (the press-release request), so they tell the two apart.
- **Exploratory real runs before the test existed** (scratchpad transcripts, not kept in the repository): Claude and Codex each ran
  - a Korean Claude-target prompt;
  - a ChatGPT + Perplexity request;
  - an English Midjourney request;
  - a negative "write the press release" request (Claude only).
  - Findings S1–S5 above come from these runs; the S1 and S2 fixes were rerun and confirmed.
- **Installed for this user** with `node scripts/install-skill.mjs`:
  - Claude Code went to `~/.claude/skills/super-prompt-maker` and Codex to `~/.agents/skills/super-prompt-maker`; Gemini was skipped because there is no `~/.gemini`.
  - User-level discovery was then confirmed from an empty folder outside any project. The ChatGPT + Perplexity request made Codex run `~/.agents/skills/super-prompt-maker/scripts/spm.mjs` (79 s) and Claude run `~/.claude/skills/super-prompt-maker/scripts/spm.mjs` (42 s).
  - Both wrote 2 prompts. Neither Perplexity prompt asks for URLs, which matches the guide.
  - The running Claude Code session also listed the new skill without a restart.
- **Not verified:**
  - Gemini CLI and Antigravity CLI, which are not installed;
  - the skill on macOS or Linux.

### This review (2026-11-02 afternoon)

- **Baseline:** before any change, `npm test` passed 16/16.
- **After round 1:**
  - 27/27 pass.
  - Three storage and input tests were run against the original `server.mjs` from `dc92e9d`. All three fail there, and all three pass with the fix.
- **After round 2:**
  - `npm test` passes **35/35**, run 3 times in a row (about 2.5 s each).
  - `node --check` passes on every JS/MJS file.
- **Mutation re-check.** Each mutation was made in a scratch copy and caught by exactly one test:
  - `uidOk` loosened;
  - proxy guard removed;
  - 409 for finished jobs removed;
  - one-poll-per-bridge removed.
- **Real CLIs (tokens spent, under the user's earlier approval for CLI testing):**
  - **Isolation flags:** `runCli` with the new flags works on both CLIs. Claude 2.1.316 answered in 4.6 s and Codex 0.166.0 in 5.2 s.
  - **Codex feature switches:** `--disable bogus_feature` fails before any model call with `Error: Unknown feature flag`.
  - **Codex file-read probe:**
    - With tools on, Codex attempted `exec_command` (`Get-Content` on a temp secret file); Windows policy refused it.
    - With the 7 features disabled, the logs show 0 command attempts.
  - **Full real-CLI suite:** `npm run test:cli` passes **7/7** in 126 s (exit 0), with all runs in parallel. Durations, with the earlier run in brackets:

    | Test | Claude | Codex |
    |---|---|---|
    | Direct run | 2.8 s (8.6 s) | 5.1 s (7.7 s) |
    | Option builder → 3 Claude-style prompts, ≥ 2 of 3 in XML | 126 s (168 s) | 71 s (90 s) |
    | Enhance → ChatGPT + Gemini, original request kept | 60 s (56 s) | 32 s (55 s) |
    | Real `spm-bridge.mjs` process → 3 Perplexity versions (min. 40 characters; the short one is now a single question by design) | 42 s (63 s) | — |

    Every generation kept the JSON contract (no fallback to raw text). The real-CLI test now uses a 420 s `waitJob` deadline, because the helper's default is 25 s.
- **Browser (preview pane, localhost:3000):**
  - "다시 만들기" restores every field with no errors.
  - Engine auto-select after the session loads works.
  - Save: a triple click stores 1 item.
  - 375 px layout: no overflow, all 5 tabs visible.
  - Deleting from the library and history now works.
  - Placeholder highlight and hint are shown.
  - `X-Frame-Options: DENY` is served, and the pane still loads.
- **External facts checked:**
  - CLOVA X closed on 2026-04-09 (several Korean sources).
  - DeepSeek V3.1 hybrid thinking.
  - Perplexity prompt guide: don't ask for URLs.
  - Gemini CLI trusted-folders doc (`GEMINI_CLI_TRUST_WORKSPACE`).
  - `claude --help` (`--safe-mode`), `codex exec --help` (`--ignore-user-config`), `codex features list`.

### Earlier in the day (historical evidence, first review and real-CLI testing)

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
- **Automated suite at that time** (`npm test`, 16 tests, 16 pass, about 0.8 s). It covered request normalization, parsing, template styles, Korean particles, history, library, 403/415/421, path traversal and the bridge flow.
- **Real CLI suite at that time** (`npm run test:cli`): all 7 tests passed, plus a separate Codex bridge run. Durations were measured with up to 8 CLI runs in parallel:

  | Test | Claude | Codex |
  |---|---|---|
  | Direct run answers | 8.6 s | 7.7 s |
  | Option builder via this PC → 3 prompts for the Claude target, ≥2 of 3 in XML tags | 168 s | 90 s |
  | Enhance via this PC → ChatGPT (Markdown sections) + Gemini versions, original request kept | 56 s | 55 s |
  | Real `spm-bridge.mjs` process → 3 Perplexity versions | 63 s | 69 s |

- **Not verified (still true):**
  - the Gemini CLI;
  - a real second PC on the LAN;
  - real phones (only viewport emulation was used);
  - macOS/Linux.
