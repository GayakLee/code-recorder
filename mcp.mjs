import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { call, ensureApp, capture, root, useWorkspace } from './src/bridge.mjs';
import { controlTools } from './src/control-schema.mjs';
import { mkdir, writeFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { sceneInput } from './src/tool-schema.mjs';
import { randomUUID } from 'node:crypto';
import scene from './extension/scene.cjs';
const jobs = new Map();
let controlHeadless = true;
function create(input) {
  scene.validateScene(input);
  const spec = input;
  if ([...jobs.values()].some(job => ['queued', 'running', 'encoding', 'stopping'].includes(job.status))) throw new Error('A movie is already running');
  const job = { id: randomUUID(), status: 'queued' }; jobs.set(job.id, job);
  void (async () => {
    try {
      await ensureApp({ headless: controlHeadless }); if (job.status === 'cancelled') return;
      const state = await call('/create', spec); job.innerId = state.id; job.status = state.status;
    } catch (error) { if (job.status !== 'cancelled') { job.status = 'failed'; job.error = error.message; } }
  })();
  return { id: job.id, status: job.status };
}
async function status(id) {
  const job = jobs.get(id); if (!job) throw new Error('Unknown movie id');
  if (job.innerId && ['running', 'encoding', 'stopping'].includes(job.status)) {
    const state = await call('/state');
    if (state.id !== job.innerId) throw new Error('Movie superseded by another client');
    Object.assign(job, state, { id, innerId: job.innerId });
  }
  const { innerId, ...result } = job; return result;
}
const server = new Server({ name: 'code-recorder', version: '0.1.0' }, { capabilities: { tools: {} } });
const idSchema = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] };
async function closeSession() {
  const { pid } = await (await capture('/window')).json();
  const result = await call('/app/close', {});
  const pids = [pid, result.extensionHostPid].filter(Number.isInteger);
  for (let i = 0; i < 100; i++) {
    let live = false;
    for (const processId of pids) {
      try { process.kill(processId, 0); live = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (!live) { result.closed = true; break; }
    await sleep(100);
  }
  if (!result.closed) throw new Error('The session has not closed; inspect its state before retrying');
  return result;
}
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  ...controlTools,
  { name: 'movie_create', description: 'Record a JSON scene in the actual editor, using an isolated offscreen session by default. Start with open, then type/move/select/scroll/wait. Returns a job ID. Does not modify existing project files.', inputSchema: sceneInput },
  { name: 'movie_status', description: 'Get latest movie state and output MP4 path. Only the latest movie is retained in memory; previous results are in tmp/<id>/result.json.', inputSchema: idSchema },
  { name: 'movie_cancel', description: 'Cancel the current movie.', inputSchema: idSchema },
] }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    let result;
    const input = params.arguments || {};
    if (controlTools.some(t => t.name === params.name)) {
      if (params.name === 'record_app' && input.headless !== undefined) {
        if (typeof input.headless !== 'boolean') throw new Error('headless must be boolean');
        if (input.headless !== controlHeadless && [...jobs.values()].some(job => ['queued', 'running', 'encoding', 'stopping'].includes(job.status))) throw new Error('Finish the current recording before switching sessions');
        controlHeadless = input.headless;
      }
      if (params.name === 'record_app' && !['start', 'state', 'close', undefined].includes(input.action)) throw new Error('Unknown app action');
      await ensureApp({ headless: controlHeadless });
      if (params.name === 'record_frame') {
        if (input.raw !== undefined && typeof input.raw !== 'boolean') throw new Error('raw must be boolean');
        const png = Buffer.from(await (await capture(input.raw ? '/frame?raw=1' : '/frame')).arrayBuffer());
        const directory = path.join(root, 'tmp', 'frames'); await mkdir(directory, { recursive: true });
        const filename = path.join(directory, `${randomUUID()}.png`); await writeFile(filename, png);
        return { content: [{ type: 'image', mimeType: 'image/png', data: png.toString('base64') }, { type: 'text', text: JSON.stringify({ path: filename }) }] };
      }
      if (params.name === 'record_camera') result = await (await capture('/camera', input)).json();
      else if (params.name === 'record_config') {
        const { action = 'get', ...settings } = input;
        if (!['get', 'set'].includes(action)) throw new Error('Unknown config action');
        result = await call('/recording/config', action === 'set' ? settings : undefined);
      } else if (params.name === 'record_project' && input.action === 'open') {
        if (!controlHeadless) throw new Error('Project switching is restricted to the isolated headless session');
        if (typeof input.path !== 'string' || !path.isAbsolute(input.path)) throw new Error('An absolute project path is required');
        const project = await realpath(input.path); const info = await stat(project);
        if (!info.isDirectory() && !(info.isFile() && project.endsWith('.code-workspace'))) throw new Error('Choose a folder or .code-workspace file');
        const state = await call('/editor/state');
        if (['running', 'encoding', 'stopping'].includes(state.recording.status) || [...jobs.values()].some(j => j.status === 'queued')) throw new Error('Stop the current recording before switching projects');
        const config = await call('/recording/config');
        await closeSession(); await sleep(300); useWorkspace(project); await ensureApp({ headless: true });
        await call('/recording/config', config.defaults);
        result = await call('/editor/state');
      }
      else if (params.name === 'record_app') {
        if (input.action === 'close') {
          result = await closeSession();
        } else result = { ...await call('/editor/state'), window: await (await capture('/window')).json() };
      } else if (params.name === 'record_recording') {
        const { action = 'status', ...spec } = input;
        if (!['start', 'stop', 'status'].includes(action)) throw new Error('Unknown recording action');
        result = action === 'status' ? await call('/state') : await call(`/recording/${action}`, spec);
      } else {
        const op = { record_file: 'file', record_type: 'type', record_cursor: 'cursor', record_zoom: 'zoom', record_scroll: 'scroll', record_project: 'project' }[params.name];
        result = await call('/editor/action', { ...input, op });
        if (op === 'zoom' || op === 'project') {
          await sleep(150);
          result.view = await (await capture('/view')).json();
        }
      }
    }
    else if (params.name === 'movie_create') result = create(params.arguments);
    else if (params.name === 'movie_status' || params.name === 'movie_cancel') {
      result = await status(params.arguments?.id);
      if (params.name === 'movie_cancel' && ['queued','running','encoding'].includes(result.status)) {
        const job = jobs.get(result.id);
        if (job.innerId) await call('/cancel', {}); else job.status = 'cancelled';
        result = await status(result.id);
      }
    } else throw new Error('Unknown tool');
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});
await server.connect(new StdioServerTransport());
