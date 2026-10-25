import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { root } from '../src/bridge.mjs';
import path from 'node:path';
test('MCP records real editor typing including CRLF, Korean and emoji', { timeout: 180000 }, async () => {
  const client = new Client({ name: 'code-recorder-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: 'node', args: [path.join(root, 'mcp.mjs')] }));
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text);
  };
  const wait = async id => {
    for (let i = 0; i < 600; i++) {
      const state = await call('movie_status', { id });
      if (!['queued', 'running', 'encoding', 'stopping'].includes(state.status)) return state;
      await sleep(250);
    }
    throw new Error('Recording timed out');
  };
  try {
    const toolNames = (await client.listTools()).tools.map(tool => tool.name);
    for (const name of ['movie_create', 'movie_status', 'movie_cancel']) assert.ok(toolNames.includes(name), `Missing compatible tool: ${name}`);
    const bad = await client.callTool({ name: 'movie_create', arguments: { actions: [{ action: 'shell' }] } }); assert.equal(bad.isError, true);
    const cancelled = await call('movie_create', { name: 'cancel-check', actions: [{ action: 'open', filename: 'cancel.py' }, { action: 'wait', durationMs: 10000 }] });
    await sleep(1000); await call('movie_cancel', { id: cancelled.id });
    assert.equal((await wait(cancelled.id)).status, 'cancelled');
    const text = '# 한글과 emoji 👋\r\ndef greet(name):\r\n    return f"Hello, {name}!"\r\n\r\nprint(greet("Movie"))\r\n';
    const job = await call('movie_create', { name: 'mcp-typing-demo', seed: 12, actions: [
      { action: 'open', filename: 'hello.py', language: 'python' },
      { action: 'wait', durationMs: 600 },
      { action: 'type', text, delayMs: 90 },
      { action: 'select', line: 2, endLine: 3 },
      { action: 'wait', durationMs: 1500 },
      { action: 'move', line: 6, column: 1 },
      { action: 'scroll', lines: 2 },
      { action: 'wait', durationMs: 800 },
    ] });
    const busy = await client.callTool({ name: 'movie_create', arguments: { actions: [{ action: 'open', filename: 'no.py' }] } }); assert.equal(busy.isError, true);
    const state = await wait(job.id); assert.equal(state.status, 'completed', state.error);
    assert.equal(state.documents['hello.py'].replace(/\r\n/g, '\n'), text.replace(/\r\n/g, '\n'));
    const probe = JSON.parse(execFileSync('ffprobe', ['-v','error','-show_streams','-show_format','-of','json',state.output], { encoding: 'utf8' }));
    const video = probe.streams.find(s => s.codec_type === 'video');
    assert.deepEqual([video.codec_name, video.width, video.height, video.avg_frame_rate], ['h264',1920,1080,'30/1']);
    const pixels = execFileSync('ffmpeg', ['-v','error','-threads','2','-ss','5','-i',state.output,'-vf','signalstats,metadata=print:file=-','-frames:v','1','-f','null','-'], { encoding: 'utf8' });
    const averageLuma = Number(pixels.match(/lavfi.signalstats.YAVG=([\d.]+)/)?.[1]);
    assert.ok(averageLuma > 20, `Captured frame is black or missing: YAVG=${averageLuma}`);
    console.log(JSON.stringify({ output: state.output, duration: probe.format.duration }));
  } finally { await client.close(); }
});
