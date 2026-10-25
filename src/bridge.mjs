import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let connection;
let headless = false;
let workspaceOverride;
export function useWorkspace(folder) { workspaceOverride = folder; connection = undefined; }
export function bridgeDirectory() { return path.join(root, 'tmp', ...(headless ? ['headless'] : [])); }
export async function capture(endpoint = '/frame', body) {
  const bridge = JSON.parse(await readFile(path.join(bridgeDirectory(), 'capture.json'), 'utf8'));
  const response = await fetch(`http://127.0.0.1:${bridge.port}${endpoint}`, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Capture HTTP ${response.status}: ${await response.text()}`);
  return response;
}
export async function call(endpoint, body) {
  const bridge = connection || JSON.parse(await readFile(path.join(bridgeDirectory(), 'bridge.json'), 'utf8'));
  if (!Number.isInteger(bridge.port) || bridge.port < 1 || bridge.port > 65535) throw new Error('Invalid bridge port');
  const response = await fetch(`http://127.0.0.1:${bridge.port}${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(body?.op === 'type' ? 300000 : 15000),
  });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || `Bridge HTTP ${response.status}`);
  connection = bridge; return result;
}
let opening;
export async function ensureApp(options = {}) {
  if (options.headless !== undefined && options.headless !== headless) {
    if (opening) throw new Error('An app launch is already in progress');
    headless = options.headless; connection = undefined;
  }
  try { return await call('/state'); } catch { connection = undefined; }
  if (!opening) opening = launchApp().finally(() => { opening = undefined; });
  return opening;
}
async function launchApp() {
  if (process.platform !== 'win32') throw new Error('Start the source build with VSCODE_RECORD_ROOT set before connecting.');
  await import('../prepare.mjs');
  const config = JSON.parse(await readFile(path.join(root, 'runtime.json'), 'utf8'));
  const session = path.join(config.data, headless ? 'headless-profile' : 'standard-profile');
  await mkdir(path.join(session, 'User'), { recursive: true });
  if (headless) {
    try { await readFile(path.join(session, 'User', 'settings.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(path.join(session, 'User', 'settings.json'), JSON.stringify({ 'security.workspace.trust.startupPrompt': 'never' })); }
  }
  const environment = { ...process.env, CODE_RECORDER_ROOT: root, CODE_RECORDER_BRIDGE_DIR: bridgeDirectory(), CODE_RECORDER_HEADLESS: headless ? '1' : '0', VSCODE_RECORD_ROOT: root, FFMPEG_PATH: config.ffmpeg,
    VSCODE_RECORD_BRIDGE_DIR: bridgeDirectory(), VSCODE_RECORD_HEADLESS: headless ? '1' : '0' };
  delete environment.ELECTRON_RUN_AS_NODE;
  const workspace = workspaceOverride || path.join(root, 'tmp', 'workspaces', 'headless');
  if (headless && !workspaceOverride) await mkdir(workspace, { recursive: true });
  const child = spawn(path.join(config.runtime, 'VSCodium.exe'), [...(headless ? [workspace, '--skip-add-to-recently-opened'] : []), '--user-data-dir', session, '--extensions-dir', config.extensions, '--skip-release-notes'], { env: environment, stdio: 'ignore', detached: true, windowsHide: headless });
  child.unref();
  const failed = new Promise((_, reject) => { child.on('error', reject); child.on('exit', code => { if (code !== 0) reject(new Error(`code-recorder exited (${code}) before its bridge became ready`)); }); });
  for (let i = 0; i < 90; i++) {
    await Promise.race([sleep(1000), failed]);
    try { return await call('/state'); } catch {}
  }
  throw new Error('code-recorder did not expose its bridge within 90 seconds.');
}
