// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Procedural keyboard clicks: no downloaded recordings or licensed sound assets.
const fs = require('node:fs/promises');
const rate = 48000;
function kindFor(char) { return char === '\n' ? 'enter' : char === ' ' ? 'space' : 'key'; }
function samples(kind) {
	const length = Math.round(rate * (kind === 'enter' ? 0.065 : 0.045));
	const data = new Float32Array(length);
	let seed = kind === 'enter' ? 81 : kind === 'space' ? 19 : 47;
	let previous = 0;
	for (let i = 0; i < length; i++) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		const noise = seed / 2147483648 - 1;
		const t = i / rate;
		const press = Math.exp(-t * 240) * Math.min(1, t * 5000);
		const release = t > 0.018 ? Math.exp(-(t - 0.018) * 330) * 0.3 : 0;
		const body = Math.sin(2 * Math.PI * (kind === 'enter' ? 760 : 1250) * t) * Math.exp(-t * 190) * 0.16;
		data[i] = ((noise - previous * 0.78) * (press + release) * 0.36 + body) * (kind === 'space' ? 0.8 : 1);
		previous = noise;
	}
	return data;
}
function header(bytes) {
	const out = Buffer.alloc(44);
	out.write('RIFF'); out.writeUInt32LE(bytes + 36, 4); out.write('WAVEfmt ', 8);
	out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
	out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
	out.write('data', 36); out.writeUInt32LE(bytes, 40); return out;
}
function makeKeyWav(kind) {
	const data = samples(kind); const pcm = Buffer.alloc(data.length * 2);
	for (let i = 0; i < data.length; i++) { pcm.writeInt16LE(Math.round(data[i] * 24000), i * 2); }
	return Buffer.concat([header(pcm.length), pcm]);
}
async function renderTrack(events, durationMs, filename) {
	if (!events.length) { return undefined; }
	const count = Math.ceil(Math.min(301000, durationMs + 100) * rate / 1000);
	const pcm = Buffer.alloc(count * 2);
	const bank = { key: samples('key'), enter: samples('enter'), space: samples('space') };
	for (const event of events) {
		const start = Math.round(event.timeMs * rate / 1000); const data = bank[event.kind];
		for (let i = 0; i < data.length && start + i < count; i++) {
			const offset = (start + i) * 2;
			if (offset < 0) { continue; }
			const mixed = pcm.readInt16LE(offset) + Math.round(data[i] * 24000 * event.volume);
			pcm.writeInt16LE(Math.max(-32768, Math.min(32767, mixed)), offset);
		}
	}
	await fs.writeFile(filename, Buffer.concat([header(pcm.length), pcm])); return filename;
}
module.exports = { kindFor, makeKeyWav, renderTrack };
