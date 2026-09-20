import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOptions, renderConfig, verifyBuild } from './install-codex.mjs';

test('default config limits scope and excludes execution and keys', () => {
  const options = parseOptions([]);
  assert.deepEqual(options.appNames, ['Otto Form Fixture', 'TextEdit']);
  const config = renderConfig(options, '/node', '/otto/server.js');
  assert.match(config, /enabled_tools = \["list_apps", "inspect"\]/u);
  assert.ok(!config.includes('--allow-actions'));
  assert.ok(!config.includes('env_vars'));
  assert.ok(!config.includes('approval_mode'));
});

test('scope overrides are exact and bounded; key forwarding requires action opt-in', () => {
  const options = parseOptions(['--app-name', 'Exact "Name"', '--app', '123', '--allow-actions', '--forward-typesafe-key']);
  assert.deepEqual(options.appNames, ['Exact "Name"']);
  const config = renderConfig(options, 'C:\\Node\\node.exe', 'C:\\Otto\\server.js');
  assert.ok(config.includes('Exact \\"Name\\"'));
  assert.ok(config.includes('C:\\\\Node\\\\node.exe'));
  assert.ok(config.includes('env_vars = ["TYPESAFE_API_KEY"]'));
  assert.throws(() => parseOptions(['--forward-typesafe-key']));
  assert.throws(() => parseOptions(['--trust-actions']));
  assert.throws(() => parseOptions(['--app-name', 'bad\nname']));
  assert.throws(() => parseOptions(['--app', '--all']));
  assert.throws(() => parseOptions(['--write']));
  assert.throws(() => parseOptions(['--app', '1', '--app', '2', '--app', '3', '--app', '4', '--app', '5']));
});

test('explicit trust applies only to local action tools and keeps the exact app scope', () => {
  const options = parseOptions(['--app', '123', '--allow-actions', '--trust-actions']);
  const config = renderConfig(options, '/node', '/otto/server.js');
  assert.match(config, /"--app", "123", "--allow-actions"/u);
  assert.match(config, /\[mcp_servers\.otto\.tools\.act\]\napproval_mode = "approve"/u);
  assert.match(config, /\[mcp_servers\.otto\.tools\.run_steps\]\napproval_mode = "approve"/u);
  assert.ok(!config.includes('tools.delegate'));
  assert.ok(!config.includes('approval_policy'));
});

test('build verification rejects missing, unsupported, and non-executable helpers', () => {
  const root = mkdtempSync(join(tmpdir(), 'otto-setup-test-'));
  try {
    assert.throws(() => verifyBuild(root, 'linux'));
    assert.throws(() => verifyBuild(root, 'darwin'));
    mkdirSync(join(root, 'dist-desktop', 'desktop'), { recursive: true });
    mkdirSync(join(root, 'desktop', 'native', 'macos'), { recursive: true });
    writeFileSync(join(root, 'dist-desktop', 'desktop', 'agent-server.js'), '');
    const helper = join(root, 'desktop', 'native', 'macos', 'otto-ax');
    writeFileSync(helper, '');
    chmodSync(helper, 0o600);
    if (process.platform !== 'win32') assert.throws(() => verifyBuild(root, 'darwin'));
    chmodSync(helper, 0o700);
    assert.equal(verifyBuild(root, 'darwin').helper, helper);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
