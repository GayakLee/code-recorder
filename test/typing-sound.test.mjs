import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { root } from '../src/bridge.mjs';
import path from 'node:path';
test('Typing sound ON has synchronized audio; OFF has no audio', { timeout: 180000 }, async () => {
  const client = new Client({ name: 'typing-sound-check', version: '1' });
  await client.connect(new StdioClientTransport({ command: 'node', args: [path.join(root, 'mcp.mjs')] }));
  async function call(name, args) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text);
  }
  try {
    for (const enabled of [true, false]) {
      const text = 'print("TypeIt sound")\n';
      const job = await call('movie_create', { name: enabled ? 'typing-sound-on' : 'typing-sound-off', typingSound: enabled, typingSoundVolume: 0.6, actions: [
        { action: 'open', filename: 'sound.py', language: 'python' },
        { action: 'wait', durationMs: 500 },
        { action: 'type', text, delayMs: 120 },
        { action: 'wait', durationMs: 600 },
      ] });
      let state;
      for (let i = 0; i < 600; i++) {
        await sleep(250); state = await call('movie_status', { id: job.id });
        if (!['queued', 'running', 'encoding', 'stopping'].includes(state.status)) break;
      }
      assert.equal(state.status, 'completed', state.error);
      assert.equal(state.typingSoundEvents, enabled ? Array.from(text).length : 0);
      assert.equal(state.liveSoundErrors, 0);
      const probe = JSON.parse(execFileSync('ffprobe', ['-v','error','-show_streams','-of','json',state.output], { encoding: 'utf8' }));
      const audio = probe.streams.filter(stream => stream.codec_type === 'audio');
      assert.equal(audio.length, enabled ? 1 : 0);
      if (enabled) {
        assert.equal(audio[0].codec_name, 'aac'); assert.equal(audio[0].sample_rate, '48000');
        const pcm = execFileSync('ffmpeg', ['-v','error','-i',state.output,'-map','0:a:0','-f','s16le','-ac','1','pipe:1'], { maxBuffer: 2000000 });
        let maximum = 0; for (let i = 0; i < pcm.length; i += 2) maximum = Math.max(maximum, Math.abs(pcm.readInt16LE(i)));
        assert.ok(maximum > 1000, `Audio is silent: ${maximum}`);
        // The opening half-second wait must remain quiet.
        let opening = 0; for (let i = 0; i < 48000 * 0.25 * 2; i += 2) opening = Math.max(opening, Math.abs(pcm.readInt16LE(i)));
        assert.ok(opening < 50, `Typing sound starts before typing: ${opening}`);
      }
      const output = path.join(root, 'outputs', enabled ? 'typing-sound-on.mp4' : 'typing-sound-off.mp4');
      await copyFile(state.output, output); console.log(JSON.stringify({ enabled, events: state.typingSoundEvents, output }));
    }
  } finally { await client.close(); }
});
