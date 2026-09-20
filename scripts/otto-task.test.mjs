import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parseTaskArgs, validateTaskFile, readTaskFile, runTask, serverArguments, serverEnvironment, MAX_FILE_BYTES } from './otto-task.mjs';

const task = { steps: [{ operation: 'fill', label: 'Name', value: 'Ada' }], expected: { values: { Name: 'Ada' } } };
const text = (value, isError = false) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError });
async function file(t, value = task) {
  const dir = await mkdtemp(join(tmpdir(), 'otto-task-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'task.json'); await writeFile(path, JSON.stringify(value)); return path;
}
function fake(responder, toolNames = ['inspect', 'run_steps', 'list_apps', 'release_control']) {
  const state = { calls: [], scopes: [], closes: 0 };
  return { state, connect: async options => {
    state.scopes.push(options);
    return { client: { listTools: async () => ({ tools: toolNames.map(name => ({ name })) }), callTool: async request => {
      state.calls.push(request); return responder(request);
    } }, close: async () => { state.closes++; } };
  } };
}

test('launcher accepts one exact scope and rejects authority/command overrides', () => {
  assert.deepEqual(parseTaskArgs(['list-apps']), { command: 'list-apps' });
  assert.deepEqual(parseTaskArgs(['inspect', '--app-name', 'TextEdit']), { command: 'inspect', appName: 'TextEdit' });
  assert.ok(!serverArguments({ command: 'inspect', appId: '123' }).includes('--allow-actions'));
  assert.ok(serverArguments({ command: 'run-steps', appId: '123' }).includes('--allow-actions'));
  for (const args of [[], ['inspect'], ['list-apps', '--app', '123'], ['inspect', '--app', '1', '--app-name', 'Other'], ['inspect', '--app', '1', '--app', '2'], ['inspect', '--app', '--all'], ['inspect', '--app', 'bad\nvalue'], ['run-steps', '--app', '1'], ['inspect', '--app', '1', '--file', 'x'], ['delegate'], ['inspect', '--app', '1', '--server', 'evil']]) {
    if (!args.length) assert.equal(parseTaskArgs(args).help, true);
    else assert.throws(() => parseTaskArgs(args));
  }
  for (const key of ['TYPESAFE_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY']) assert.equal(Object.hasOwn(serverEnvironment(), key), false);
});

test('workflow accepts literal steps and rejects scope, credentials, extra fields, and size excess', () => {
  assert.deepEqual(validateTaskFile(task), task);
  assert.equal(validateTaskFile({ steps: [{ operation: 'key', value: 'enter' }] }).steps[0].value, 'enter');
  assert.equal(validateTaskFile({ steps: [{ operation: 'fill', label: 'Command', value: '$(literal); `data`' }] }).steps.length, 1);
  for (const bad of [
    { ...task, appId: 'outside' }, { ...task, apiKey: 'private' }, { steps: [] }, { steps: Array(17).fill(task.steps[0]) },
    { steps: [{ operation: 'exec', value: 'command' }] }, { steps: [{ operation: 'fill', label: 'Password', value: 'private' }] },
    { steps: [{ operation: 'fill', label: 'Name', value: 'sk-abcdefghijklmnop123456789' }] },
    { steps: [{ operation: 'fill', label: 'Name', value: 'x'.repeat(2001) }] },
    { steps: [{ operation: 'key', value: 'cmd+enter' }] }, { steps: [{ operation: 'press', label: 'Save', value: 'x' }] },
    { ...task, expected: {} }, { ...task, expected: { appId: 'other' } },
  ]) assert.throws(() => validateTaskFile(bad));
});

test('file reader is byte bounded, regular-file only, and never echoes invalid content', async t => {
  const path = await file(t);
  assert.deepEqual(await readTaskFile(path), task);
  await writeFile(path, 'x'.repeat(MAX_FILE_BYTES + 1));
  await assert.rejects(readTaskFile(path), /64 KiB/);
  await writeFile(path, 'PRIVATE_CONTENT_NOT_JSON');
  await assert.rejects(readTaskFile(path), error => { assert.doesNotMatch(String(error), /PRIVATE_CONTENT/); return true; });
  await assert.rejects(readTaskFile(join(path, '..')));
  if (process.platform !== 'win32') {
    const link = path + '.link'; await symlink(path, link);
    await assert.rejects(readTaskFile(link));
  }
});

test('name lookup remains within launcher name, resolves one ID, and closes after inspect', async () => {
  const connection = fake(request => request.name === 'list_apps' ? text({ apps: [{ id: '4321', name: 'Exact App' }] }) : text('compact selected-app context'));
  const result = await runTask(parseTaskArgs(['inspect', '--app-name', 'Exact App']), connection);
  assert.equal(result.exitCode, 0); assert.equal(result.output, 'compact selected-app context');
  assert.equal(connection.state.scopes[0].appName, 'Exact App');
  assert.deepEqual(connection.state.calls, [{ name: 'list_apps', arguments: {} }, { name: 'inspect', arguments: { appId: '4321' } }]);
  assert.equal(connection.state.closes, 1);
});

test('ambiguous/missing/expanded app lists never inspect or write', async () => {
  for (const apps of [[], [{ id: '1', name: 'Other' }], [{ id: '1', name: 'Exact' }, { id: '2', name: 'Exact' }]]) {
    const connection = fake(() => text({ apps }));
    await assert.rejects(runTask({ command: 'inspect', appName: 'Exact' }, connection));
    assert.equal(connection.state.calls.length, 1); assert.equal(connection.state.closes, 1);
  }
});

test('run_steps injects only resolved scope and preserves the compact stopped receipt', async t => {
  const path = await file(t);
  const receipt = { status: 'stopped', actions: 1, completedSteps: 0, uncertainAction: true, reason: 'Changed target' };
  const connection = fake(() => text(receipt));
  const result = await runTask({ command: 'run-steps', appId: '123', file: path }, connection);
  assert.equal(result.exitCode, 2); assert.deepEqual(JSON.parse(result.output), receipt);
  assert.deepEqual(connection.state.calls, [{ name: 'run_steps', arguments: { appId: '123', ...task } }]);
  assert.equal(connection.state.closes, 1);
  const forbidden = await file(t, { ...task, appId: 'outside' });
  const unopened = fake(() => { throw new Error('Must not open'); });
  await assert.rejects(runTask({ command: 'run-steps', appId: '123', file: forbidden }, unopened));
  assert.equal(unopened.state.scopes.length, 0);
});

test('ownership and transport failures never retry; older servers are refused before native calls', async () => {
  for (const code of ['desktop_busy', 'desktop_unavailable']) {
    const busy = fake(() => text({ code, message: 'Control unavailable' }, true));
    const result = await runTask({ command: 'inspect', appId: '123' }, busy);
    assert.equal(result.exitCode, 2); assert.equal(JSON.parse(result.output).code, code);
    assert.equal(busy.state.calls.length, 1); assert.equal(busy.state.closes, 1);
  }
  const broken = fake(() => { throw new Error('PRIVATE_SERVER_ERROR'); });
  await assert.rejects(runTask({ command: 'inspect', appId: '123' }, broken), error => { assert.doesNotMatch(String(error), /PRIVATE_SERVER_ERROR/); return true; });
  assert.equal(broken.state.calls.length, 1); assert.equal(broken.state.closes, 1);
  const old = fake(() => { throw new Error('Must not call'); }, ['inspect', 'run_steps']);
  await assert.rejects(runTask({ command: 'inspect', appId: '123' }, old), /ownership coordination/);
  assert.equal(old.state.calls.length, 0); assert.equal(old.state.closes, 1);
});

test('discovery exposes names/IDs only and aborted requests do not connect', async () => {
  const result = await runTask({ command: 'list-apps' }, { discover: async () => ({ apps: [{ id: '123', name: 'Fixture', privateData: 'omit' }], permissions: {} }) });
  assert.deepEqual(JSON.parse(result.output), { apps: [{ id: '123', name: 'Fixture' }] });
  const cancelled = fake(() => text('unexpected'));
  await assert.rejects(runTask({ command: 'inspect', appId: '123' }, { ...cancelled, signal: AbortSignal.abort() }));
  assert.equal(cancelled.state.scopes.length, 0);
});

test('official SDK stdio performs scoped discovery/workflow and closes its fake server', { timeout: 15_000 }, async t => {
  const path = await file(t);
  const module = name => JSON.stringify(import.meta.resolve(name));
  const script = `
    import { Server } from ${module('@modelcontextprotocol/sdk/server/index.js')};
    import { StdioServerTransport } from ${module('@modelcontextprotocol/sdk/server/stdio.js')};
    import { ListToolsRequestSchema, CallToolRequestSchema } from ${module('@modelcontextprotocol/sdk/types.js')};
    const server=new Server({name:'owned-protocol-fixture',version:'1'},{capabilities:{tools:{}}});
    server.setRequestHandler(ListToolsRequestSchema,()=>({tools:['list_apps','run_steps','release_control'].map(name=>({name,inputSchema:{type:'object'}}))}));
    server.setRequestHandler(CallToolRequestSchema,request=>{
      const p=request.params;
      if(p.name==='list_apps')return{content:[{type:'text',text:JSON.stringify({apps:[{id:'fixture-id',name:'Protocol Fixture'}]})}]};
      if(p.name!=='run_steps'||p.arguments.appId!=='fixture-id'||p.arguments.steps[0].value!=='Ada')throw new Error('Scope or literal mismatch');
      return{content:[{type:'text',text:JSON.stringify({status:'verified',actions:1,completedSteps:1,modelCalls:0})}]};
    });
    process.stdin.on('end',()=>server.close());await server.connect(new StdioServerTransport());
  `;
  let transport;
  const result = await runTask({ command: 'run-steps', appName: 'Protocol Fixture', file: path }, { connect: async options => {
    assert.equal(options.appName, 'Protocol Fixture');
    const client = new Client({ name: 'otto-task-test', version: '1' });
    transport = new StdioClientTransport({ command: process.execPath, args: ['--input-type=module', '-e', script], stderr: 'pipe' });
    transport.stderr.on('data', () => undefined);
    t.after(() => transport.close());
    await client.connect(transport);
    return { client, close: () => client.close() };
  } });
  assert.equal(result.exitCode, 0); assert.equal(JSON.parse(result.output).status, 'verified');
  assert.equal(transport.pid, null);
});
