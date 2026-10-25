import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { root } from '../src/bridge.mjs';

test('MCP zoom changes UI and code fonts independently in headless video', { timeout: 180000 }, async () => {
  const config = JSON.parse(await readFile(path.join(root, 'runtime.json'), 'utf8'));
  const settingsPath = path.join(config.data, 'standard-profile', 'User', 'settings.json');
  const userSettings = await readFile(settingsPath);
  const client = new Client({ name: 'zoom-check', version: '1' });
  await client.connect(new StdioClientTransport({ command: 'node', args: [path.join(root, 'mcp.mjs')] }));
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content.find(c => c.type === 'text').text);
  }
  const id = randomUUID();
  const directory = path.join(root, 'tmp', 'zoom-checks', id); await mkdir(directory, { recursive: true });
  let recording = false;
  const frames = [];
  let start;
  async function snapshot(name, view) {
    const result = await client.callTool({ name: 'record_frame', arguments: {} });
    assert.ok(!result.isError);
    const image = result.content.find(c => c.type === 'image');
    await writeFile(path.join(directory, `${name}.png`), Buffer.from(image.data, 'base64'));
    frames.push({ name, atSeconds: (performance.now() - start) / 1000, view });
    assert.equal(view.visible, false); assert.equal(view.offscreen, true);
    await sleep(650);
  }
  const zoom = (target, action, steps = 1) => call('record_zoom', { target, action, steps });
  try {
    await call('record_app', { action: 'start', headless: true });
    const text = '# MCP zoom demo\ndef greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("Record"))\n';
    await call('record_file', { action: 'create', path: `zoom/${id}/demo.py`, text });
    await zoom('editor', 'reset');
    await zoom('ui', 'reset');
    await call('record_recording', { action: 'start', name: 'mcp-zoom', width: 1280, height: 720 }); recording = true; start = performance.now();
    const base = (await zoom('ui', 'reset')).view;
    assert.ok(base.editors[0].fontSize > 0);
    await snapshot('01-baseline', base);
    const uiIn = (await zoom('ui', 'in', 2)).view;
    assert.ok(uiIn.zoomFactor > base.zoomFactor); await snapshot('02-ui-in', uiIn);
    const uiOut = (await zoom('ui', 'out', 3)).view;
    assert.ok(uiOut.zoomFactor < base.zoomFactor); await snapshot('03-ui-out', uiOut);
    const uiReset = (await zoom('ui', 'reset')).view;
    assert.ok(Math.abs(uiReset.zoomFactor - base.zoomFactor) < 0.001); await snapshot('04-ui-reset', uiReset);
    const editorIn = (await zoom('editor', 'in', 4)).view;
    assert.ok(editorIn.editors[0].fontSize > base.editors[0].fontSize);
    assert.equal(editorIn.zoomFactor, base.zoomFactor); assert.equal(editorIn.sidebarFontSize, base.sidebarFontSize);
    await snapshot('05-editor-in', editorIn);
    const editorOut = (await zoom('editor', 'out', 6)).view;
    assert.ok(editorOut.editors[0].fontSize < base.editors[0].fontSize); await snapshot('06-editor-out', editorOut);
    const editorReset = (await zoom('editor', 'reset')).view;
    assert.equal(editorReset.editors[0].fontSize, base.editors[0].fontSize); await snapshot('07-editor-reset', editorReset);
    const invalid = await client.callTool({ name: 'record_zoom', arguments: { target: 'ui', action: 'in', steps: 0 } });
    assert.equal(invalid.isError, true);
    await call('record_recording', { action: 'stop' });
    let result;
    for (let i = 0; i < 80; i++) {
      result = await call('record_recording', { action: 'status' });
      if (['completed', 'failed', 'cancelled'].includes(result.status)) break;
      await sleep(250);
    }
    assert.equal(result.status, 'completed', result.error); recording = false;
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', result.output], { encoding: 'utf8' }));
    assert.ok(probe.streams.some(s => s.codec_name === 'h264' && s.width === 1280 && s.height === 720));
    for (const frame of frames) {
      execFileSync('ffmpeg', ['-v', 'error', '-threads', '2', '-ss', String(frame.atSeconds), '-i', result.output, '-frames:v', '1', '-y', path.join(directory, `video-${frame.name}.png`)]);
    }
    const document = await call('record_file', { action: 'read', path: `zoom/${id}/demo.py` });
    assert.equal(document.text.replace(/\r\n/g, '\n'), text);
    assert.deepEqual(await readFile(settingsPath), userSettings);
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({ output: result.output, frames }, null, 2));
    console.log(JSON.stringify({ output: result.output, directory, uiFactors: [base, uiIn, uiOut, uiReset].map(v => v.zoomFactor), fontSizes: [base, editorIn, editorOut, editorReset].map(v => v.editors[0].fontSize) }));
  } finally {
    if (recording) { await call('record_recording', { action: 'stop' }).catch(() => {}); await sleep(1500); }
    await zoom('ui', 'reset').catch(() => {}); await zoom('editor', 'reset').catch(() => {});
    await call('record_app', { action: 'close' }); await client.close();
  }
});
