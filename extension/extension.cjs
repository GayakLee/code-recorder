// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
const vscode = require('vscode');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');
const { validateScene } = require('./scene.cjs');
const { startRecording, exportMovie } = require('./recorder.cjs');
const { editorState, editorAction } = require('./control.cjs');
let state = { status: 'idle' };
let active;
let recordingDefaults = { width: 1920, height: 1080, fps: 30 };
async function activate(context) {
	const root = process.env.CODE_RECORDER_ROOT || process.env.VSCODE_RECORD_ROOT || process.env.VSCODE_MOVIE_ROOT;
	if (!root) { return; }
	const bridgeDirectory = process.env.CODE_RECORDER_BRIDGE_DIR || process.env.VSCODE_RECORD_BRIDGE_DIR || path.join(root, 'tmp');
	await fs.mkdir(bridgeDirectory, { recursive: true });
	await fs.mkdir(path.join(root, 'tmp'), { recursive: true });
	await fs.mkdir(path.join(root, 'outputs'), { recursive: true });
	const token = crypto.randomBytes(32).toString('hex');
	const indicator = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
	context.subscriptions.push(indicator);
	const readyButton = () => { indicator.text = '$(circle-filled)'; indicator.tooltip = vscode.l10n.t('Start Recording'); };
	readyButton(); indicator.color = new vscode.ThemeColor('errorForeground'); indicator.command = 'movie.toggleRecording'; indicator.show();
	async function play(spec, controller, dir, recorder) {
		let editor;
		let seed = spec.seed >>> 0;
		const documents = new Map();
		for (const [index, step] of spec.actions.entries()) {
			controller.signal.throwIfAborted(); state.step = index + 1;
			await fs.appendFile(path.join(dir, 'actions.jsonl'), JSON.stringify({ step: state.step, action: step.action, at: new Date().toISOString() }) + '\n');
			if (step.action === 'open') {
				let document = documents.get(step.filename);
				if (!document) {
					const uri = vscode.Uri.from({ scheme: 'untitled', path: `Movie-${state.id.slice(0, 8)}-${step.filename}` });
					document = await vscode.workspace.openTextDocument(uri);
					if (step.language) { document = await vscode.languages.setTextDocumentLanguage(document, step.language); }
					documents.set(step.filename, document);
					editor = await vscode.window.showTextDocument(document, { preview: false });
					if (step.text) { await editor.edit(edit => edit.insert(new vscode.Position(0, 0), step.text)); }
				} else { editor = await vscode.window.showTextDocument(document, { preview: false }); }
				continue;
			}
			if (step.action === 'wait') { await sleep(step.durationMs, undefined, { signal: controller.signal }); continue; }
			if (!editor) { throw new Error('Open a document before editor actions'); }
			if (step.action === 'type') {
				for (const char of Array.from(step.text.replace(/\r\n?/g, '\n'))) {
					controller.signal.throwIfAborted();
					const start = editor.document.offsetAt(editor.selection.start);
					if (!await editor.edit(edit => edit.replace(editor.selection, char), { undoStopBefore: false, undoStopAfter: false })) { throw new Error('Editor rejected typing'); }
					const config = vscode.workspace.getConfiguration('movie');
					if (spec.typingSound ?? config.get('typingSound.enabled', false)) {
						recorder.key(char, spec.typingSoundVolume ?? config.get('typingSound.volume', 0.35));
					}
					const insertedLength = char === '\n' && editor.document.eol === vscode.EndOfLine.CRLF ? 2 : char.length;
					const position = editor.document.positionAt(start + insertedLength);
					editor.selection = new vscode.Selection(position, position);
					editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.Default);
					seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
					await sleep((step.delayMs ?? 70) * (0.8 + (seed / 4294967296) * 0.4), undefined, { signal: controller.signal });
				}
			}
			if (step.action === 'move' || step.action === 'select') {
				const start = editor.document.validatePosition(new vscode.Position(step.line - 1, (step.column ?? 1) - 1));
				const end = step.action === 'select' ? editor.document.lineAt(Math.min((step.endLine ?? step.line) - 1, editor.document.lineCount - 1)).range.end : start;
				editor.selection = new vscode.Selection(start, end);
				editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
			}
			if (step.action === 'scroll') { await vscode.commands.executeCommand('editorScroll', { to: step.lines < 0 ? 'up' : 'down', by: 'line', value: Math.abs(step.lines), revealCursor: false }); }
		}
		return Object.fromEntries([...documents].map(([name, doc]) => [name, doc.getText()]));
	}
	async function execute(spec, controller, dir) {
		let recorder;
		let finalStatus = 'failed';
		const timer = setTimeout(() => controller.abort(), 300000);
		try {
			await fs.mkdir(dir, { recursive: true });
			await fs.writeFile(path.join(dir, 'scene.json'), JSON.stringify(spec, null, 2));
			// Prepare an empty document before capture so the welcome screen is excluded.
			const first = spec.actions[0];
			if (!spec.manual) {
				if (!first || first.action !== 'open') { throw new Error('First action must open a document'); }
				await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: first.language || 'plaintext' }));
			}
			recorder = await startRecording(dir, spec);
			controller.recorder = recorder;
			if (spec.manual) { await controller.recordingFinished; }
			else { state.documents = await play(spec, controller, dir, recorder); }
			await sleep(600, undefined, { signal: controller.signal });
			const raw = await recorder.stop();
			state.typingSoundEvents = recorder.soundEvents.length;
			state.liveSoundErrors = recorder.soundErrors.length;
			spec.typingSoundPath = recorder.soundPath;
			recorder = undefined;
			controller.signal.throwIfAborted(); state.status = 'encoding';
			const output = path.join(root, 'outputs', `${spec.name}-${state.id.slice(0, 8)}.mp4`);
			await exportMovie(raw, output, spec);
			controller.signal.throwIfAborted(); state.output = output; finalStatus = 'completed';
			if (spec.manual) { vscode.window.showInformationMessage(vscode.l10n.t('Recording Saved: {0}', output)); }
		} catch (error) {
			finalStatus = controller.signal.aborted ? 'cancelled' : 'failed'; state.status = 'stopping'; state.error = error.message;
			vscode.window.showErrorMessage(error.message);
		} finally {
			clearTimeout(timer); if (recorder) { await recorder.stop().catch(() => {}); }
			state.status = finalStatus;
			state.finishedAt = new Date().toISOString();
			const result = JSON.stringify(state, null, 2);
			active = undefined;
			readyButton();
			await fs.writeFile(path.join(dir, 'result.json'), result).catch(() => {});
		}
	}
	function create(input) {
		if (active) { throw new Error('A movie is already running'); }
		const spec = validateScene({ ...recordingDefaults, ...input });
		const controller = new AbortController();
		controller.spec = spec;
		if (spec.manual) {
			controller.recordingFinished = new Promise(resolve => { controller.stopRecording = resolve; });
			controller.signal.addEventListener('abort', () => controller.stopRecording(), { once: true });
		}
		state = { id: crypto.randomUUID(), status: 'running', step: 0, createdAt: new Date().toISOString(), video: { width: spec.width, height: spec.height, fps: spec.fps } };
		active = controller; indicator.text = '$(debug-stop)'; indicator.tooltip = vscode.l10n.t('Stop Recording');
		void execute(spec, controller, path.join(root, 'tmp', state.id));
		return { ...state };
	}
	context.subscriptions.push(vscode.commands.registerCommand('movie.toggleRecording', () => {
		if (active?.stopRecording) { active.stopRecording(); return; }
		if (active) { vscode.window.showWarningMessage(vscode.l10n.t('A Movie Is Already Running')); return; }
		create({ name: 'recording', manual: true, keepWindowSize: true, actions: [] });
	}));
	context.subscriptions.push(vscode.commands.registerCommand('movie.toggleTypingSound', async () => {
		const config = vscode.workspace.getConfiguration('movie');
		const enabled = !config.get('typingSound.enabled', false);
		await config.update('typingSound.enabled', enabled, vscode.ConfigurationTarget.Global);
		vscode.window.showInformationMessage(vscode.l10n.t(enabled ? 'Typing Sound: On' : 'Typing Sound: Off'));
	}));
	context.subscriptions.push(vscode.commands.registerCommand('movie.typeIt', () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) { return; }
		const text = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
		if (!text) { return; }
		try { create({ name: 'typeit', keepWindowSize: true, actions: [
			{ action: 'open', filename: path.basename(editor.document.fileName).replace(/[^\w .-]/g, '_'), language: editor.document.languageId },
			{ action: 'type', text, delayMs: vscode.workspace.getConfiguration('movie').get('typingDelayMs', 70) }
		] }); } catch (error) { vscode.window.showErrorMessage(error.message); }
	}));
	context.subscriptions.push(vscode.commands.registerCommand('movie.recordDemo', async () => {
		try { create(JSON.parse(await fs.readFile(path.join(root, 'examples', 'demo.json'), 'utf8'))); }
		catch (error) { vscode.window.showErrorMessage(error.message); }
	}));
	context.subscriptions.push(vscode.commands.registerCommand('movie.recordScene', async () => {
		const files = await vscode.window.showOpenDialog({ filters: { JSON: ['json'] }, canSelectMany: false });
		if (files?.[0]) { try { create(JSON.parse(await fs.readFile(files[0].fsPath, 'utf8'))); } catch (error) { vscode.window.showErrorMessage(error.message); } }
	}));
	context.subscriptions.push(vscode.commands.registerCommand('movie.cancel', () => active?.abort()));
	const server = http.createServer(async (request, response) => {
		response.setHeader('Content-Type', 'application/json');
		if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401); response.end('{}'); return; }
		try {
			let result;
			if (request.method === 'GET' && request.url === '/state') { result = state; }
			else if (request.url === '/recording/config' && ['GET', 'POST'].includes(request.method)) {
				if (request.method === 'POST') {
					if (active) throw new Error('Change recording settings before starting a recording');
					const chunks = []; let size = 0;
					for await (const chunk of request) { size += chunk.length; if (size > 4096) throw new Error('Settings request too large'); chunks.push(chunk); }
					const input = JSON.parse(Buffer.concat(chunks).toString());
					if (Object.keys(input).some(k => !['width', 'height', 'fps'].includes(k))) throw new Error('Only width, height and fps are configurable');
					const spec = validateScene({ ...recordingDefaults, ...input, actions: [] });
					recordingDefaults = { width: spec.width, height: spec.height, fps: spec.fps };
				}
				result = { defaults: recordingDefaults, active: active ? state.video : null };
			}
			else if (request.method === 'GET' && request.url === '/editor/state') { result = { ...editorState(), recording: state, headless: (process.env.CODE_RECORDER_HEADLESS ?? process.env.VSCODE_RECORD_HEADLESS) === '1' }; }
			else if (request.method === 'POST' && ['/editor/action', '/recording/start', '/recording/stop', '/app/close'].includes(request.url)) {
				const chunks = []; let size = 0;
				for await (const chunk of request) { size += chunk.length; if (size > 1000000) throw new Error('Request too large'); chunks.push(chunk); }
				const input = JSON.parse(Buffer.concat(chunks).toString() || '{}');
				if (request.url === '/editor/action') {
					if (active && !active.stopRecording) throw new Error('Wait for the scripted recording to finish');
					result = await editorAction(input, char => {
						const config = vscode.workspace.getConfiguration('movie');
						if (active?.recorder && (active.spec.typingSound ?? config.get('typingSound.enabled', false))) active.recorder.key(char, active.spec.typingSoundVolume ?? config.get('typingSound.volume', 0.35));
					});
				} else if (request.url === '/recording/start') {
					create({ ...input, manual: true, actions: [] });
					for (let i = 0; i < 200 && active && !active.recorder; i++) await sleep(50);
					if (!active?.recorder) throw new Error(state.error || 'Recorder did not become ready');
					result = state;
				} else if (request.url === '/recording/stop') {
					if (!active?.stopRecording) throw new Error('No interactive recording is running');
					active.stopRecording(); result = state;
				} else {
					if ((process.env.CODE_RECORDER_HEADLESS ?? process.env.VSCODE_RECORD_HEADLESS) !== '1') throw new Error('API close is restricted to the isolated headless session');
					if (active) throw new Error('Stop the recording before closing');
					result = { closing: true, extensionHostPid: process.pid };
					setTimeout(() => { void vscode.commands.executeCommand('workbench.action.quit'); }, 200);
				}
			}
			else if (request.method === 'POST' && request.url === '/create') {
				const chunks = []; let size = 0;
				for await (const chunk of request) { size += chunk.length; if (size > 1000000) { throw new Error('Scene too large'); } chunks.push(chunk); }
				result = create(JSON.parse(Buffer.concat(chunks).toString()));
			} else if (request.method === 'POST' && request.url === '/recording/toggle') { await vscode.commands.executeCommand('movie.toggleRecording'); result = state; }
			else if (request.method === 'POST' && request.url === '/cancel') { active?.abort(); result = state; }
			else { response.writeHead(404); response.end('{}'); return; }
			response.end(JSON.stringify(result));
		} catch (error) { response.writeHead(400); response.end(JSON.stringify({ error: error.message })); }
	});
	context.subscriptions.push({ dispose: () => { active?.abort(); server.close(); } });
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	await fs.writeFile(path.join(bridgeDirectory, 'bridge.json'), JSON.stringify({ port: server.address().port, token, pid: process.pid }), { mode: 0o600 });
}
module.exports = { activate };
