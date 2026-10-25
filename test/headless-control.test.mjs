import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { root } from '../src/bridge.mjs';

test('Hidden editor is controlled and recorded entirely through MCP', { timeout: 180000 }, async () => {
  const config = JSON.parse(await readFile(path.join(root, 'runtime.json'), 'utf8'));
  const settingsPath = path.join(config.data, 'standard-profile', 'User', 'settings.json');
  const originalSettings = await readFile(settingsPath);
  const client = new Client({ name: 'headless-control-check', version: '1' });
  await client.connect(new StdioClientTransport({ command: 'node', args: [path.join(root, 'mcp.mjs')] }));
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content.find(c => c.type === 'text').text);
  }
  let running = false;
  try {
    const app = await call('record_app', { action: 'start', headless: true });
    assert.equal(app.window.headless, true);
    assert.equal(app.window.offscreen, true);
    assert.equal(app.window.visible, false);
    assert.ok(app.window.windows.every(w => !w.visible));
    assert.equal(app.workspaceFolders[0].toLowerCase(), path.join(root, 'tmp', 'workspaces', 'headless').toLowerCase());
    const file = `checks/${randomUUID()}/hello.py`;
    const created = await call('record_file', { action: 'create', path: file, text: '' });
    const listing = await call('record_file', { action: 'list', path: path.posix.dirname(file) });
    assert.ok(listing.entries.some(e => e.name === 'hello.py' && e.type === 'file'));
    for (const bad of ['../outside.py', 'C:/outside.py']) {
      const result = await client.callTool({ name: 'record_file', arguments: { action: 'create', path: bad, text: '' } });
      assert.equal(result.isError, true);
    }
    const duplicate = await client.callTool({ name: 'record_file', arguments: { action: 'create', path: file, text: 'overwrite' } });
    assert.equal(duplicate.isError, true);
    await call('record_recording', { action: 'start', name: 'headless-mcp', width: 1280, height: 720, typingSound: true }); running = true;
    const text = '# MCP only: 한글 👋\nprint("Hidden editor")\n';
    await call('record_type', { text, delayMs: 35 });
    const document = await call('record_file', { action: 'read', path: file });
    assert.equal(document.text.replace(/\r\n/g, '\n'), text);
    assert.equal((await readFile(created.path)).length, 0, 'Typing must not save implicitly');
    await call('record_cursor', { action: 'select', line: 1, endLine: 1 });
    await call('record_cursor', { action: 'move', line: 2, column: 1 });
    await call('record_cursor', { action: 'scroll', lines: 1 });
    await sleep(250);
    const frame = await client.callTool({ name: 'record_frame', arguments: {} });
    assert.ok(!frame.isError);
    const png = frame.content.find(c => c.type === 'image');
    assert.equal(png.mimeType, 'image/png');
    assert.equal(Buffer.from(png.data, 'base64').readUInt32BE(0), 0x89504e47);
    const preview = JSON.parse(frame.content.find(c => c.type === 'text').text).path;
    await call('record_file', { action: 'save', path: file });
    assert.equal((await readFile(created.path, 'utf8')).replace(/\r\n/g, '\n'), text);
    await call('record_recording', { action: 'stop' });
    let result;
    for (let i = 0; i < 60; i++) {
      result = await call('record_recording', { action: 'status' });
      if (['completed', 'failed', 'cancelled'].includes(result.status)) break;
      await sleep(500);
    }
    running = false;
    assert.equal(result.status, 'completed', result.error);
    assert.ok((await stat(result.output)).size > 0);
    assert.ok(result.typingSoundEvents > 0);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', result.output], { encoding: 'utf8' }));
    assert.ok(probe.streams.some(s => s.codec_name === 'h264' && s.width === 1280 && s.height === 720));
    assert.ok(probe.streams.some(s => s.codec_name === 'aac'));
    const after = await call('record_app', { action: 'state' });
    assert.equal(after.window.visible, false);
    assert.deepEqual(await readFile(settingsPath), originalSettings);
    const scripted = await call('movie_create', { name: 'headless-scene', actions: [{ action: 'open', filename: 'script.py', text: 'print("scene")' }, { action: 'wait', durationMs: 400 }] });
    for (let i = 0; i < 60; i++) {
      const state = await call('movie_status', { id: scripted.id });
      if (!['queued', 'running', 'encoding', 'stopping'].includes(state.status)) { assert.equal(state.status, 'completed', state.error); break; }
      if (i === 59) assert.fail('Scripted recording timed out');
      await sleep(500);
    }
    console.log(JSON.stringify({ output: result.output, preview, hidden: !after.window.visible, typingSoundEvents: result.typingSoundEvents }));
  } finally {
    if (running) { await call('record_recording', { action: 'stop' }).catch(() => {}); await sleep(1000); }
    const closed = await call('record_app', { action: 'close' }).catch(error => { if (!running) throw error; });
    if (closed) assert.equal(closed.closed, true);
    await client.close();
  }
});
