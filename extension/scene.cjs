// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
const actions = new Set(['open', 'type', 'wait', 'select', 'move', 'scroll']);
function validateScene(input) {
	if (!input || !Array.isArray(input.actions) || input.actions.length > 200) { throw new Error('Scene requires up to 200 actions'); }
	const scene = { name: 'typing', width: 1920, height: 1080, fps: 30, seed: 1, ...input };
	if (!/^[a-zA-Z0-9_-]{1,70}$/.test(scene.name)) { throw new Error('Invalid movie name'); }
	for (const key of ['width', 'height']) {
		if (!Number.isInteger(scene[key]) || scene[key] < 240 || scene[key] > 3840 || scene[key] % 2) { throw new Error('Invalid even video dimensions'); }
	}
	if (!Number.isInteger(scene.fps) || scene.fps < 1 || scene.fps > 60) { throw new Error('Invalid fps'); }
	if (!Number.isInteger(scene.seed)) { throw new Error('seed must be an integer'); }
	if (scene.typingSound !== undefined && typeof scene.typingSound !== 'boolean') { throw new Error('typingSound must be boolean'); }
	if (scene.typingSoundVolume !== undefined && (!Number.isFinite(scene.typingSoundVolume) || scene.typingSoundVolume < 0 || scene.typingSoundVolume > 1)) { throw new Error('typingSoundVolume must be between 0 and 1'); }
	let milliseconds = 0;
	for (const action of scene.actions) {
		if (!action || !actions.has(action.action)) { throw new Error('Unknown scene action'); }
		if (action.action === 'open' && (typeof action.filename !== 'string' || !/^[\w .-]{1,100}$/.test(action.filename))) { throw new Error('open requires a simple filename'); }
		if (action.action === 'open' && action.text !== undefined && (typeof action.text !== 'string' || action.text.length > 100000)) { throw new Error('Initial text too large'); }
		if (action.action === 'type') {
			if (typeof action.text !== 'string' || action.text.length > 30000) { throw new Error('type requires text'); }
			const delay = action.delayMs ?? 70;
			if (!Number.isFinite(delay) || delay < 0 || delay > 1000) { throw new Error('Invalid typing delay'); }
			milliseconds += Array.from(action.text).length * delay * 1.25;
		}
		if (action.action === 'wait') {
			if (!Number.isInteger(action.durationMs) || action.durationMs < 0 || action.durationMs > 60000) { throw new Error('Invalid wait duration'); }
			milliseconds += action.durationMs;
		}
		for (const field of ['line', 'column', 'endLine']) {
			if (action[field] !== undefined && (!Number.isInteger(action[field]) || action[field] < 1)) { throw new Error('Invalid cursor position'); }
		}
		if (['move', 'select'].includes(action.action) && !action.line) { throw new Error('line required'); }
		if (action.action === 'scroll' && (!Number.isInteger(action.lines) || Math.abs(action.lines) > 10000)) { throw new Error('Invalid scroll lines'); }
	}
	if (milliseconds > 280000) { throw new Error('Scene exceeds five minute limit'); }
	if (scene.audioPath !== undefined && typeof scene.audioPath !== 'string') { throw new Error('audioPath must be a path'); }
	return scene;
}
module.exports = { validateScene };
