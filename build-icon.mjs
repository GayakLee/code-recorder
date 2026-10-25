import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
// Original editor-window and recording motif; no upstream brand artwork.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect x="12" y="24" width="220" height="186" rx="32" fill="#182635"/><rect x="26" y="38" width="192" height="158" rx="20" fill="#243C50"/><path d="M28 72h188" stroke="#8AB7CC" stroke-width="8"/><circle cx="46" cy="55" r="5" fill="#8AB7CC"/><circle cx="64" cy="55" r="5" fill="#8AB7CC"/><path d="m86 100-28 28 28 28m58-56 28 28-28 28m-26-64-16 72" fill="none" stroke="#E2F3FA" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><circle cx="204" cy="204" r="40" fill="#F23645" stroke="#FFFFFF" stroke-width="8"/></svg>`;
const assets = path.join(root, 'assets'); await mkdir(assets, { recursive: true });
await writeFile(path.join(assets, 'code-recorder.svg'), svg);
execFileSync('python', ['-c', 'import cairosvg,sys; cairosvg.svg2png(url=sys.argv[1],write_to=sys.argv[2],output_width=256,output_height=256)', path.join(assets, 'code-recorder.svg'), path.join(assets, 'code-recorder.png')]);
execFileSync('python', ['-c', 'from PIL import Image; import sys; Image.open(sys.argv[1]).save(sys.argv[2],format="ICO",sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])', path.join(assets, 'code-recorder.png'), path.join(assets, 'code-recorder.ico')]);
