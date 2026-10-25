// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { kindFor, renderTrack } = require('./typing-sound.cjs');
function ffmpeg(args) {
	const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-filter_threads', '2', ...args], { windowsHide: true });
	child.log = ''; child.stderr.on('data', data => { child.log = (child.log + data).slice(-8000); });
	child.stdin.on('error', () => {});
	child.finished = new Promise((resolve, reject) => {
		child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg (${code}): ${child.log}`)));
	});
	child.finished.catch(() => {});
	return child;
}
async function startRecording(dir, spec) {
	const bridgeDirectory = process.env.CODE_RECORDER_BRIDGE_DIR || process.env.VSCODE_RECORD_BRIDGE_DIR || path.join(process.env.CODE_RECORDER_ROOT || process.env.VSCODE_RECORD_ROOT || process.env.VSCODE_MOVIE_ROOT, 'tmp');
	const bridge = JSON.parse(await fs.readFile(path.join(bridgeDirectory, 'capture.json'), 'utf8'));
	async function request(endpoint) {
		const response = await fetch(`http://127.0.0.1:${bridge.port}${endpoint}`, { headers: { Authorization: `Bearer ${bridge.token}` }, signal: AbortSignal.timeout(10000) });
		if (!response.ok) { throw new Error(`Editor capture: ${await response.text()}`); }
		return response;
	}
	await request(`/rate?fps=${spec.fps}`);
	if (!spec.keepWindowSize) { await request(`/prepare?width=${spec.width}&height=${spec.height}`); }
	await sleep(300);
	const initial = await request('/frame?format=bgra');
	const inputWidth = Number(initial.headers.get('X-Frame-Width')); const inputHeight = Number(initial.headers.get('X-Frame-Height'));
	if (![inputWidth, inputHeight].every(n => Number.isInteger(n) && n > 0 && n <= 8192)) throw new Error('Invalid bitmap response');
	let latest = Buffer.from(await initial.arrayBuffer());
	if (latest.length !== inputWidth * inputHeight * 4) throw new Error('Invalid bitmap payload');
	const frameEndpoint = `/frame?format=bgra&width=${inputWidth}&height=${inputHeight}`;
	const raw = path.join(dir, 'capture.mkv');
	const child = ffmpeg(['-f', 'rawvideo', '-pixel_format', 'bgra', '-video_size', `${inputWidth}x${inputHeight}`, '-framerate', String(spec.fps), '-i', 'pipe:0', '-an', '-vf', `scale=${spec.width}:${spec.height}:force_original_aspect_ratio=decrease,pad=${spec.width}:${spec.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`, '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', '-n', raw]);
	let stopped = false; let frames = 0;
	let captures = 1; let repeatedFrames = 0; let fresh = true;
	const soundEvents = []; const soundErrors = []; const pendingSounds = new Set();
	const started = performance.now();
	// Keep one uncompressed bitmap and honor encoder backpressure; never accumulate a frame queue.
	const pump = (async () => {
		try {
			while (!stopped) {
				const wanted = Math.floor((performance.now() - started) * spec.fps / 1000) + 1;
				if (wanted - frames > spec.fps * 3) { throw new Error('Frame encoder cannot keep up'); }
				while (frames < wanted) {
					if (!child.stdin.write(latest)) { await once(child.stdin, 'drain'); }
					if (!fresh) repeatedFrames++; fresh = false;
					frames++;
				}
				const untilNext = frames * 1000 / spec.fps - (performance.now() - started);
				if (untilNext > 1) await sleep(Math.min(untilNext, 3));
				if (!stopped) {
					const next = Buffer.from(await (await request(frameEndpoint)).arrayBuffer());
					if (next.length !== inputWidth * inputHeight * 4) throw new Error('Bitmap size changed unexpectedly');
					latest = next; captures++; fresh = true;
				}
			}
		} finally { child.stdin.end(); }
	})();
	pump.catch(() => {});
	const recording = { soundEvents, soundErrors, soundPath: undefined,
		key(char, volume) {
			if (volume <= 0) { return; }
			const event = { timeMs: performance.now() - started, kind: kindFor(char), volume };
			soundEvents.push(event);
			const pending = fetch(`http://127.0.0.1:${bridge.port}/sound`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: event.kind, volume }), signal: AbortSignal.timeout(3000) })
				.then(async response => { if (!response.ok) { throw new Error(await response.text()); } })
				.catch(error => { soundErrors.push(error.message); }).finally(() => pendingSounds.delete(pending));
			pendingSounds.add(pending);
		},
		async stop() {
		stopped = true;
		const timer = setTimeout(() => child.kill(), 15000);
		try { await pump; await child.finished; await Promise.allSettled(pendingSounds); } finally { clearTimeout(timer); }
		recording.soundPath = await renderTrack(soundEvents, frames * 1000 / spec.fps, path.join(dir, 'typing.wav'));
		await fs.writeFile(path.join(dir, 'typing-events.json'), JSON.stringify(soundEvents));
		await fs.writeFile(path.join(dir, 'capture-stats.json'), JSON.stringify({ transport: 'bgra', captures, frames, repeatedFrames, captureSamplesPerSecond: captures / (frames / spec.fps) }, null, 2));
		return raw;
	} };
	return recording;
}
async function exportMovie(raw, output, spec) {
	const args = ['-nostdin', '-i', raw];
	if (spec.audioPath) { await fs.access(spec.audioPath); args.push('-i', path.resolve(spec.audioPath)); }
	if (spec.typingSoundPath) { args.push('-i', spec.typingSoundPath); }
	args.push('-map', '0:v:0');
	if (spec.audioPath && spec.typingSoundPath) { args.push('-filter_complex', '[1:a][2:a]amix=inputs=2:duration=longest:normalize=0,apad[audio]', '-map', '[audio]', '-shortest', '-c:a', 'aac', '-ar', '48000', '-b:a', '192k'); }
	else if (spec.audioPath || spec.typingSoundPath) { args.push('-map', '1:a:0', '-af', 'apad', '-shortest', '-c:a', 'aac', '-ar', '48000', '-b:a', '192k'); }
	else { args.push('-an'); }
	args.push('-vf', `fps=${spec.fps}`, '-c:v', 'libx264', '-threads', '2', '-crf', '18', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-n', output);
	await ffmpeg(args).finished;
}
module.exports = { startRecording, exportMovie };
