import { ensureApp, capture } from './bridge.mjs';
await ensureApp({ headless: true });
console.log(JSON.stringify(await (await capture('/window')).json()));
