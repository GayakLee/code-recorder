/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { app, BrowserWindow } from 'electron';
import type { NativeImage } from 'electron';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = process.env['CODE_RECORDER_ROOT'] || process.env['VSCODE_RECORD_ROOT'] || process.env['VSCODE_MOVIE_ROOT'];
if (root) {
	const headless = (process.env['CODE_RECORDER_HEADLESS'] ?? process.env['VSCODE_RECORD_HEADLESS']) === '1';
	const frames = new Map<number, NativeImage>();
	const bridgeDirectory = process.env['CODE_RECORDER_BRIDGE_DIR'] || process.env['VSCODE_RECORD_BRIDGE_DIR'] || path.join(root, 'tmp');
	const sound = createRequire(import.meta.url)(path.join(root, 'extension', 'typing-sound.cjs')) as { makeKeyWav(kind: string): Buffer };
	const { Camera } = createRequire(import.meta.url)(path.join(root, 'extension', 'camera.cjs'));
	const camera = new Camera();
	app.commandLine.appendSwitch('disable-renderer-backgrounding');
	if (headless) {
		app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
		app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
	}
	app.on('browser-window-created', async (_event, window) => {
		window.setIcon(path.join(root, 'assets', 'code-recorder.ico'));
		if (headless) {
			window.webContents.setFrameRate(30);
			window.webContents.on('paint', (_event, _rect, image) => frames.set(window.id, image));
			window.on('closed', () => frames.delete(window.id));
			window.setSkipTaskbar(true);
			window.hide();
			window.show = () => {};
			window.showInactive = () => {};
			window.focus = () => {};
			window.on('show', () => window.hide());
		}
	});
	void app.whenReady().then(async () => {
		const token = randomBytes(32).toString('hex');
		const server = createServer(async (request, response) => {
			if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401); response.end(); return; }
			try {
				const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes('/workbench/'));
				if (!window) { throw new Error('Editor window is not ready'); }
				window.webContents.setBackgroundThrottling(false);
				const url = new URL(request.url || '/', 'http://localhost');
				if (url.pathname === '/camera') {
					let input = { action: 'state' };
					if (request.method === 'POST') {
						const chunks: Buffer[] = []; let length = 0;
						for await (const chunk of request) { length += chunk.length; if (length > 4096) throw new Error('Camera request too large'); chunks.push(chunk); }
						input = JSON.parse(Buffer.concat(chunks).toString());
					}
					response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(camera.update(input)));
				} else if (url.pathname === '/rate') {
					const fps = Number(url.searchParams.get('fps'));
					if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error('FPS must be an integer from 1 to 60');
					if (headless) window.webContents.setFrameRate(fps);
					response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ fps }));
				} else if (url.pathname === '/view') {
					// Read renderer metrics for verification; zoom itself uses editor commands.
					const metrics = await window.webContents.executeJavaScript(`(() => {
						const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
						const editors = Array.from(document.querySelectorAll('.monaco-editor .view-lines')).filter(visible).map(e => ({ fontSize: parseFloat(getComputedStyle(e).fontSize), lineHeight: parseFloat(getComputedStyle(e).lineHeight) }));
						const sidebar = document.querySelector('.part.sidebar');
						const quickInput = document.querySelector('.quick-input-widget');
						return { editors, sidebarFontSize: sidebar ? parseFloat(getComputedStyle(sidebar).fontSize) : null, projectPickerVisible: !!quickInput && visible(quickInput) };
					})()`);
					response.setHeader('Content-Type', 'application/json');
					response.end(JSON.stringify({ ...metrics, zoomLevel: window.webContents.getZoomLevel(), zoomFactor: window.webContents.getZoomFactor(), visible: window.isVisible(), offscreen: window.webContents.isOffscreen() }));
				} else if (url.pathname === '/window') {
					response.setHeader('Content-Type', 'application/json');
					response.end(JSON.stringify({ headless, offscreen: window.webContents.isOffscreen(), painting: headless ? window.webContents.isPainting() : undefined, hasFrame: frames.has(window.id), visible: window.isVisible(), windows: BrowserWindow.getAllWindows().map(w => ({ visible: w.isVisible(), title: w.getTitle() })), size: window.getContentSize(), pid: process.pid }));
				} else if (url.pathname === '/sound' && request.method === 'POST') {
					const chunks: Buffer[] = []; let length = 0;
					for await (const chunk of request) { length += chunk.length; if (length > 1024) { throw new Error('Sound request too large'); } chunks.push(chunk); }
					const value = JSON.parse(Buffer.concat(chunks).toString()) as { kind: string; volume: number };
					if (!['key', 'enter', 'space'].includes(value.kind) || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1) { throw new Error('Invalid sound'); }
					const wav = sound.makeKeyWav(value.kind).toString('base64');
					await window.webContents.executeJavaScript(`(async () => { const ctx = globalThis.__movieAudio || (globalThis.__movieAudio = new AudioContext()); await ctx.resume(); const bytes = Uint8Array.from(atob('${wav}'), c => c.charCodeAt(0)); const buffer = await ctx.decodeAudioData(bytes.buffer); const source = ctx.createBufferSource(); source.buffer = buffer; const gain = ctx.createGain(); gain.gain.value = ${value.volume}; source.connect(gain); gain.connect(ctx.destination); source.start(); })()`, true);
					response.end('{}');
				} else if (url.pathname === '/prepare') {
					const width = Number(url.searchParams.get('width'));
					const height = Number(url.searchParams.get('height'));
					if (![width, height].every(value => Number.isInteger(value) && value >= 240 && value <= 3840)) { throw new Error('Invalid capture dimensions'); }
					window.unmaximize(); window.setContentSize(width, height);
					response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ width, height }));
				} else if (url.pathname === '/frame') {
					const bitmap = url.searchParams.get('format') === 'bgra';
					// Offscreen paint frames do not depend on native window visibility.
					if (headless) {
						const previous = frames.get(window.id);
						window.webContents.startPainting();
						window.webContents.invalidate();
						for (let i = 0; i < 30 && !frames.has(window.id); i++) await sleep(50);
						if (!bitmap) for (let i = 0; i < 10 && frames.get(window.id) === previous; i++) await sleep(5);
					}
					let frame = headless ? (frames.get(window.id) || await window.webContents.capturePage(undefined, { stayHidden: false, stayAwake: true })) : await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
					if (!frame) throw new Error('Offscreen renderer has not painted yet');
					if (frame.isEmpty()) { throw new Error('Editor frame is empty'); }
					if (url.searchParams.get('raw') !== '1') {
						const size = frame.getSize(); const rect = camera.rect(size.width, size.height);
						if (rect.width !== size.width || rect.height !== size.height) frame = frame.crop(rect).resize({ width: size.width, height: size.height, quality: 'best' });
					}
					if (bitmap) {
						const size = frame.getSize();
						const width = Number(url.searchParams.get('width') || size.width);
						const height = Number(url.searchParams.get('height') || size.height);
						if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 8192)) throw new Error('Invalid bitmap dimensions');
						let pixels: Buffer;
						if (size.width === width && size.height === height) pixels = frame.toBitmap({ scaleFactor: 1 });
						else {
							const fit = Math.min(width / size.width, height / size.height);
							const w = Math.max(1, Math.round(size.width * fit)); const h = Math.max(1, Math.round(size.height * fit));
							const scaled = frame.resize({ width: w, height: h }).toBitmap({ scaleFactor: 1 });
							pixels = Buffer.alloc(width * height * 4);
							const x = Math.floor((width - w) / 2); const y = Math.floor((height - h) / 2);
							for (let row = 0; row < h; row++) scaled.copy(pixels, ((row + y) * width + x) * 4, row * w * 4, (row + 1) * w * 4);
						}
						if (pixels.length !== width * height * 4) throw new Error('Unexpected bitmap size');
						response.setHeader('Content-Type', 'application/octet-stream'); response.setHeader('X-Frame-Width', width); response.setHeader('X-Frame-Height', height);
						response.end(pixels);
					} else { response.setHeader('Content-Type', 'image/png'); response.end(frame.toPNG()); }
				} else { response.writeHead(404); response.end(); }
			} catch (error) { response.writeHead(500); response.end(error instanceof Error ? error.message : String(error)); }
		});
		server.listen(0, '127.0.0.1', async () => {
			const address = server.address();
			if (!address || typeof address === 'string') { return; }
			await mkdir(bridgeDirectory, { recursive: true });
			await writeFile(path.join(bridgeDirectory, 'capture.json'), JSON.stringify({ port: address.port, token, pid: process.pid }), { mode: 0o600 });
		});
		app.on('will-quit', () => server.close());
	});
}
