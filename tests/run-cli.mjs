// `npm run test:cli` — runs the real CLI tests (spends tokens) on any shell, including PowerShell/cmd.
// Limit providers with SPM_CLI_PROVIDERS=claude or =codex.
import { spawnSync } from 'node:child_process';

const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', 'tests/cli.test.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, SPM_CLI_TEST: '1' },
});
process.exit(r.status ?? 1);
