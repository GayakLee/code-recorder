import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { call, ensureApp } from './src/bridge.mjs';
const args = process.argv.slice(2);
const headless = args.includes('--headless');
const scenePath = args.find(arg => arg !== '--headless');
if (!scenePath) { console.error('Usage: node cli.mjs [--headless] scene.json'); process.exitCode = 1; }
else {
  await ensureApp(headless ? { headless: true } : {});
  const job = await call('/create', JSON.parse(await readFile(scenePath, 'utf8')));
  process.once('SIGINT', () => void call('/cancel', {}));
  let state;
  do { await sleep(1000); state = await call('/state'); } while (['running', 'encoding', 'stopping'].includes(state.status));
  if (state.id !== job.id) throw new Error('Recording replaced');
  console.log(JSON.stringify(state, null, 2)); if (state.status !== 'completed') process.exitCode = 1;
}
