#!/usr/bin/env node
import { existsSync, statSync, accessSync, constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultNames = ['Otto Form Fixture', 'TextEdit'];

export function parseOptions(args) {
  const options = { appNames: [], appIds: [], allowActions: false, trustActions: false, forwardKey: false, project: process.cwd(), help: false };
  const value = (index, flag) => {
    const item = args[index];
    if (!item || item.startsWith('--') || item.length > 256 || /[\x00-\x1f\x7f]/u.test(item))
      throw new Error(`${flag} requires a nonempty value without control characters.`);
    return item;
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--app-name') options.appNames.push(value(++i, arg));
    else if (arg === '--app') options.appIds.push(value(++i, arg));
    else if (arg === '--project') options.project = resolve(value(++i, arg));
    else if (arg === '--allow-actions') options.allowActions = true;
    else if (arg === '--trust-actions') options.trustActions = true;
    else if (arg === '--forward-typesafe-key') options.forwardKey = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}. Use --help.`);
  }
  if (!options.appNames.length && !options.appIds.length) options.appNames = [...defaultNames];
  options.appNames = [...new Set(options.appNames)];
  options.appIds = [...new Set(options.appIds)];
  if (options.appNames.length + options.appIds.length > 4) throw new Error('Choose at most four explicit apps.');
  if (options.forwardKey && !options.allowActions) throw new Error('--forward-typesafe-key requires --allow-actions.');
  if (options.trustActions && !options.allowActions) throw new Error('--trust-actions requires --allow-actions.');
  return options;
}

function tomlString(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/u.test(value)) throw new Error('Configuration values cannot contain control characters.');
  return JSON.stringify(value);
}

export function renderConfig(options, nodePath, serverPath) {
  const args = [serverPath];
  for (const name of options.appNames) args.push('--app-name', name);
  for (const id of options.appIds) args.push('--app', id);
  if (options.allowActions) args.push('--allow-actions');
  const tools = options.allowActions ? ['list_apps', 'inspect', 'act', 'run_steps', 'delegate', 'release_control'] : ['list_apps', 'inspect', 'release_control'];
  return [
    '[mcp_servers.otto]',
    `command = ${tomlString(nodePath)}`,
    `args = [${args.map(tomlString).join(', ')}]`,
    `enabled_tools = [${tools.map(tomlString).join(', ')}]`,
    'startup_timeout_sec = 30',
    // Leave time for the server's 120-second deadline to return its receipt.
    'tool_timeout_sec = 150',
    ...(options.forwardKey ? ['env_vars = ["TYPESAFE_API_KEY"]'] : []),
    '',
    ...(options.trustActions ? [
      '# Trust these local tools within the launcher app scope. The host still enforces task authorization.',
      '[mcp_servers.otto.tools.act]',
      'approval_mode = "approve"',
      '',
      '[mcp_servers.otto.tools.run_steps]',
      'approval_mode = "approve"',
      '',
    ] : []),
  ].join('\n');
}

export function verifyBuild(root, platform = process.platform) {
  if (!['darwin', 'win32'].includes(platform)) throw new Error('Otto native integration supports macOS and Windows.');
  const server = join(root, 'dist-desktop', 'desktop', 'agent-server.js');
  const helper = platform === 'darwin'
    ? join(root, 'desktop', 'native', 'macos', 'otto-ax')
    : join(root, 'desktop', 'native', 'windows', 'otto-uia.ps1');
  for (const path of [server, helper]) {
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Build output missing: ${path}. Run npm run build in the Otto checkout first.`);
  }
  if (platform === 'darwin') accessSync(helper, constants.X_OK);
  return { server, helper };
}

export function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) {
    process.stdout.write(`Print a reviewed project MCP configuration for Otto; writes no configuration files.\n\nUsage: node scripts/install-codex.mjs [options]\n  --app-name <exact-name>  Allow a running application by exact name (repeatable).\n  --app <native-id>        Allow one exact native application ID (repeatable).\n  --project <directory>    Project receiving the printed configuration; defaults to cwd.\n  --allow-actions         Opt in to act, run_steps, and delegate.\n  --trust-actions         Trust act/run_steps within that scope; requires --allow-actions.\n  --forward-typesafe-key  Forward TYPESAFE_API_KEY from the MCP host environment; never reads or prints it.\n  --help                  Show this help.\n\nDefault app names: Otto Form Fixture and TextEdit. At most four apps.\nThe default is read-only. Review output before merging it into .codex/config.toml.\n`);
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use Node 24 or newer.');
  if (!existsSync(options.project) || !statSync(options.project).isDirectory()) throw new Error('The project directory does not exist.');
  const { server } = verifyBuild(sourceRoot);
  const target = join(options.project, '.codex', 'config.toml');
  process.stderr.write(`Verified local build paths. Target: ${target}\nNo configuration was written. Merge this one table without duplicating an existing mcp_servers.otto table.\nRestart/reload the MCP connection and verify its tools before use. Native permissions are not tested by this command.\n`);
  process.stdout.write(renderConfig(options, process.execPath, server));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    process.stderr.write(`Otto setup: ${error instanceof Error ? error.message : 'Configuration generation failed.'}\n`);
    process.exitCode = 1;
  }
}
