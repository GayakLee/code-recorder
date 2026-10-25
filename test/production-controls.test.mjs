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

test('Camera, FPS, project controls and scrolling work through headless MCP', { timeout: 180000 }, async () => {
  const client = new Client({ name: 'production-controls-check', version: '1' });
  await client.connect(new StdioClientTransport({ command: 'node', args: [path.join(root, 'mcp.mjs')] }));
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content.find(c => c.type === 'text').text);
  }
  const id = randomUUID(); const directory = path.join(root, 'tmp', 'production-checks', id);
  await mkdir(directory, { recursive: true });
  const config = JSON.parse(await readFile(path.join(root, 'runtime.json'), 'utf8'));
  const settingsPath = path.join(config.data, 'standard-profile/User/settings.json'); const originalSettings = await readFile(settingsPath);
  const frames = [];
  let recording = false; let start;
  async function frame(name, raw = false) {
    const response = await client.callTool({ name: 'record_frame', arguments: { raw } }); assert.ok(!response.isError);
    const png = Buffer.from(response.content.find(c => c.type === 'image').data, 'base64');
    await writeFile(path.join(directory, `${name}.png`), png);
    frames.push({ name, atSeconds: (performance.now() - start) / 1000 }); await sleep(400);
    return png;
  }
  try {
    await call('record_app', { action: 'start', headless: true });
    await call('record_camera', { action: 'reset' });
    const fps = await call('record_config', { action: 'set', fps: 25, width: 1280, height: 720 }); assert.equal(fps.defaults.fps, 25);
    const filename = `production/${id}/demo.py`;
    const text = Array.from({ length: 600 }, (_, i) => `print("Frame ${String(i + 1).padStart(3, '0')}: camera zoom, pan and scroll")`).join('\n');
    await call('record_file', { action: 'create', path: filename, text });
    const baseline = (await call('record_zoom', { target: 'ui', action: 'reset' })).view;
    await call('record_recording', { action: 'start', name: 'camera-scroll-fps', typingSound: false }); recording = true; start = performance.now();
    assert.equal((await call('record_config')).active.fps, 25);
    const busy = await client.callTool({ name: 'record_config', arguments: { action: 'set', fps: 60 } }); assert.equal(busy.isError, true);
    await frame('01-full');
    await call('record_camera', { action: 'set', scale: 2, x: 0.55, y: 0.3, durationMs: 700 });
    await sleep(200);
    const middle = await call('record_camera', { action: 'state' }); assert.ok(middle.scale > 1 && middle.scale < 2);
    await sleep(650);
    assert.equal((await call('record_camera', { action: 'state' })).scale, 2);
    const closeup = await frame('02-closeup'); const raw = await frame('03-raw', true); assert.notDeepEqual(closeup, raw);
    const unchanged = (await call('record_project', { action: 'current' })).view;
    assert.equal(unchanged.zoomFactor, baseline.zoomFactor); assert.equal(unchanged.editors[0].fontSize, baseline.editors[0].fontSize);
    await call('record_camera', { action: 'set', x: 0.25, y: 0.6, durationMs: 400 }); await sleep(500); await frame('04-pan');
    const invalid = await client.callTool({ name: 'record_camera', arguments: { action: 'set', scale: 0 } }); assert.equal(invalid.isError, true);
    await call('record_camera', { action: 'reset', durationMs: 400 }); await sleep(500); await frame('05-reset');
    const scrolled = await call('record_scroll', { mode: 'toLine', line: 240, durationMs: 500 });
    assert.ok(scrolled.active.visibleRanges[0].startLine > 200); assert.equal(scrolled.active.line, 1); await frame('06-line-240');
    await call('record_scroll', { mode: 'pages', amount: 2 }); await call('record_scroll', { mode: 'lines', amount: -5 });
    const bottom = await call('record_scroll', { mode: 'bottom' }); assert.ok(bottom.active.visibleRanges.at(-1).endLine >= 590);
    const top = await call('record_scroll', { mode: 'top', durationMs: 300 }); assert.equal(top.active.visibleRanges[0].startLine, 1);
    const projects = await call('record_project', { action: 'list' }); assert.ok(projects.projects.length > 0);
    const picker = await call('record_project', { action: 'show' }); assert.equal(picker.view.projectPickerVisible, true); await frame('07-project-picker');
    const hiddenPicker = await call('record_project', { action: 'hide' }); assert.equal(hiddenPicker.view.projectPickerVisible, false);
    await call('record_project', { action: 'explorer' });
    await call('record_recording', { action: 'stop' });
    let result;
    for (let i = 0; i < 80; i++) { result = await call('record_recording', { action: 'status' }); if (['completed', 'failed', 'cancelled'].includes(result.status)) break; await sleep(250); }
    assert.equal(result.status, 'completed', result.error); recording = false;
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', result.output], { encoding: 'utf8' }));
    const video = probe.streams.find(s => s.codec_type === 'video'); assert.equal(video.avg_frame_rate, '25/1'); assert.equal(video.width, 1280); assert.equal(video.height, 720);
    for (const f of frames.filter(f => f.name !== '03-raw')) execFileSync('ffmpeg', ['-v', 'error', '-threads', '2', '-ss', String(f.atSeconds), '-i', result.output, '-frames:v', '1', '-y', path.join(directory, `video-${f.name}.png`)]);
    const project = path.join(directory, 'sample-project'); await mkdir(project); await writeFile(path.join(project, 'README.txt'), 'Project control check');
    const opened = await call('record_project', { action: 'open', path: project }); assert.equal(opened.workspaceFolders[0].toLowerCase(), project.toLowerCase());
    assert.equal((await call('record_config')).defaults.fps, 25);
    await call('record_file', { action: 'create', path: 'new.py', text: 'print("New project")\n' });
    const app = await call('record_app', { action: 'state' }); assert.equal(app.window.visible, false); assert.equal(app.window.offscreen, true);
    assert.deepEqual(await readFile(settingsPath), originalSettings);
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({ output: result.output, frames, fps: video.avg_frame_rate, project }, null, 2));
    console.log(JSON.stringify({ output: result.output, directory, fps: video.avg_frame_rate, projectOpened: true }));
  } finally {
    if (recording) { await call('record_recording', { action: 'stop' }).catch(() => {}); await sleep(1500); }
    await call('record_camera', { action: 'reset' }).catch(() => {});
    await call('record_app', { action: 'close' }); await client.close();
  }
});
