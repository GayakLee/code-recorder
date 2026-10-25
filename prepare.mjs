import { readFile, writeFile, mkdir, cp, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const root = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(root, 'runtime.json'), 'utf8'));
const captureSource = await readFile(path.join(root, 'native', 'movieCapture.ts'), 'utf8');
await writeFile(path.join(config.source, 'src', 'movieCapture.ts'), captureSource);
const sourceMain = path.join(config.source, 'src', 'main.ts');
let mainText = await readFile(sourceMain, 'utf8');
if (!mainText.includes("import './movieCapture.js';")) await writeFile(sourceMain, "import './movieCapture.js';\n" + mainText);
const runtimeMain = path.join(config.runtime, 'resources', 'app', 'out', 'main.js');
mainText = await readFile(runtimeMain, 'utf8');
if (!mainText.includes("import './movieCapture.mjs';")) await writeFile(runtimeMain, "import './movieCapture.mjs';\n" + mainText);
await writeFile(path.dirname(runtimeMain) + '/movieCapture.mjs', stripTypeScriptTypes(captureSource));
// Opt the real editor window into Electron offscreen rendering only for automation.
const runtimeImpl = path.join(config.runtime, 'resources', 'app', 'out', 'mainImpl.js');
let runtimeImplText = await readFile(runtimeImpl, 'utf8');
if (!runtimeImplText.includes('/* vscode-record-offscreen */')) {
  const constructor = /new ([\w$]+)\.BrowserWindow\(([\w$]+)\)/g;
  let count = 0;
  runtimeImplText = runtimeImplText.replace(constructor, (match, electron, options) => {
    count++;
    return `new ${electron}.BrowserWindow(/* vscode-record-offscreen */process.env.VSCODE_RECORD_HEADLESS === '1' ? {...${options}, show: false, webPreferences: {...${options}.webPreferences, additionalArguments: [...(${options}.webPreferences?.additionalArguments || []), '--vscode-record-offscreen-editor'], offscreen: true, backgroundThrottling: false}} : ${options})`;
  });
  if (count !== 1) throw new Error('Unsupported runtime: could not locate the editor BrowserWindow constructor uniquely');
  await writeFile(runtimeImpl, runtimeImplText);
}
// Upgrade the initial offscreen patch without replacing unrelated runtime code.
runtimeImplText = runtimeImplText.replace(/(\/\* vscode-record-offscreen \*\/[\s\S]*?webPreferences: \{\.\.\.([\w$]+)\.webPreferences), offscreen: true/, "$1, additionalArguments: [...($2.webPreferences?.additionalArguments || []), '--vscode-record-offscreen-editor'], offscreen: true");
if (!runtimeImplText.includes('/* vscode-record-editor-registration */')) {
  let count = 0;
  runtimeImplText = runtimeImplText.replace(/\.filter\(([\w$]+)=>!\1\.webContents\.isOffscreen\(\)\)/g, (_match, win) => {
    count++;
    return `.filter(${win}=>!${win}.webContents.isOffscreen() || (/* vscode-record-editor-registration */process.env.VSCODE_RECORD_HEADLESS === '1' && ${win}.webContents.getLastWebPreferences().additionalArguments?.includes('--vscode-record-offscreen-editor')))`;
  });
  if (count !== 1) throw new Error('Unsupported runtime: offscreen editor registry changed');
}
if (!runtimeImplText.includes('/* vscode-record-managed-editor */')) {
  let count = 0;
  runtimeImplText = runtimeImplText.replace(/new ([\w$]+)\.BrowserWindow\(\/\* vscode-record-offscreen \*\/process\.env\.VSCODE_RECORD_HEADLESS === '1' \? \{\.\.\.([\w$]+),[\s\S]*?\}\} : \2\)/g, match => {
    count++;
    return `Object.assign(${match}, {__vscodeRecordEditor: process.env.VSCODE_RECORD_HEADLESS === '1'}) /* vscode-record-managed-editor */`;
  });
  if (count !== 1) throw new Error('Could not tag the managed offscreen editor');
}
runtimeImplText = runtimeImplText.replace(/([\w$]+)\.webContents\.getLastWebPreferences\(\)\.additionalArguments\?\.includes\('--vscode-record-offscreen-editor'\)/g, '$1.__vscodeRecordEditor === true');
await writeFile(runtimeImpl, runtimeImplText);
const sourceWindow = path.join(config.source, 'src/vs/platform/windows/electron-main/windowImpl.ts');
let sourceWindowText = await readFile(sourceWindow, 'utf8');
if (!sourceWindowText.includes('/* vscode-record-offscreen */')) {
  const target = 'new electron.BrowserWindow(options)';
  if (sourceWindowText.split(target).length !== 2) throw new Error('Unsupported source: editor window constructor changed');
  sourceWindowText = sourceWindowText.replace(target, "new electron.BrowserWindow(/* vscode-record-offscreen */process.env['VSCODE_RECORD_HEADLESS'] === '1' ? { ...options, show: false, webPreferences: { ...options.webPreferences, additionalArguments: [...(options.webPreferences?.additionalArguments || []), '--vscode-record-offscreen-editor'], offscreen: true, backgroundThrottling: false } } : options)");
  await writeFile(sourceWindow, sourceWindowText);
}
sourceWindowText = sourceWindowText.replace('...options.webPreferences, offscreen: true', "...options.webPreferences, additionalArguments: [...(options.webPreferences?.additionalArguments || []), '--vscode-record-offscreen-editor'], offscreen: true");
if (!sourceWindowText.includes('/* vscode-record-managed-editor */')) {
  sourceWindowText = sourceWindowText.replace(/new electron\.BrowserWindow\(\/\* vscode-record-offscreen \*\/[\s\S]*?\} : options\)/, match => `Object.assign(${match}, { __vscodeRecordEditor: process.env['VSCODE_RECORD_HEADLESS'] === '1' }) /* vscode-record-managed-editor */`);
}
await writeFile(sourceWindow, sourceWindowText);
const sourceWindows = path.join(config.source, 'src/vs/platform/windows/electron-main/windows.ts');
let sourceWindowsText = await readFile(sourceWindows, 'utf8');
if (!sourceWindowsText.includes('/* vscode-record-editor-registration */')) {
  const target = '.filter(win => !win.webContents.isOffscreen())';
  if (sourceWindowsText.split(target).length !== 2) throw new Error('Unsupported source: offscreen editor registry changed');
  sourceWindowsText = sourceWindowsText.replace(target, ".filter(win => !win.webContents.isOffscreen() || (/* vscode-record-editor-registration */process.env['VSCODE_RECORD_HEADLESS'] === '1' && win.webContents.getLastWebPreferences().additionalArguments?.includes('--vscode-record-offscreen-editor')))");
  await writeFile(sourceWindows, sourceWindowsText);
}
sourceWindowsText = sourceWindowsText.replace("win.webContents.getLastWebPreferences().additionalArguments?.includes('--vscode-record-offscreen-editor')", "('__vscodeRecordEditor' in win && win.__vscodeRecordEditor === true)");
await writeFile(sourceWindows, sourceWindowsText);
const branding = {
  nameShort: 'code-recorder', nameLong: 'code-recorder', applicationName: 'code-recorder',
  // Preserve legacy storage locations so existing settings and sessions survive the rename.
  dataFolderName: '.vscode-movie', sharedDataFolderName: '.vscode-movie-shared', win32MutexName: 'code-recorder',
  win32DirName: 'code-recorder', win32NameVersion: 'code-recorder', win32RegValueName: 'CodeRecorder',
  win32AppUserModelId: 'MovieTools.CodeRecorder', win32ShellNameShort: 'code-recorder', urlProtocol: 'code-recorder',
};
for (const target of [config.runtime, config.source]) {
  const productPath = target === config.runtime ? path.join(target, 'resources', 'app', 'product.json') : path.join(target, 'product.json');
  const product = JSON.parse(await readFile(productPath, 'utf8'));
  Object.assign(product, branding);
  for (const key of ['updateUrl', 'downloadUrl']) delete product[key];
  product.extensionsGallery = { serviceUrl: 'https://open-vsx.org/vscode/gallery', itemUrl: 'https://open-vsx.org/vscode/item', latestUrlTemplate: 'https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest', controlUrl: 'https://raw.githubusercontent.com/EclipseFdn/publish-extensions/refs/heads/master/extension-control/extensions.json' };
  product.enableTelemetry = false;
  if (target === config.source) product.builtInExtensions = [];
  await writeFile(productPath, JSON.stringify(product, null, '\t') + '\n');
  const extensions = target === config.runtime ? path.join(target, 'resources', 'app', 'extensions') : path.join(target, 'extensions');
  await cp(path.join(root, 'extension'), path.join(extensions, 'movie-director'), { recursive: true });
}
const user = path.join(config.data, 'standard-profile', 'User'); await mkdir(user, { recursive: true });
try { await readFile(path.join(user, 'settings.json')); } catch { await writeFile(path.join(user, 'settings.json'), '{}\n'); }
// Original code-recorder artwork, independent of upstream branding.
const svgIcon = path.join(root, 'assets', 'code-recorder.svg');
const icoIcon = path.join(root, 'assets', 'code-recorder.ico');
for (const relative of ['out/media/code-icon.svg', 'out/vs/workbench/browser/media/code-icon.svg']) {
  await copyFile(svgIcon, path.join(config.runtime, 'resources', 'app', relative));
}
await copyFile(icoIcon, path.join(config.runtime, 'resources/app/resources/win32/code.ico'));
await copyFile(svgIcon, path.join(config.source, 'src/vs/workbench/browser/media/code-icon.svg'));
await copyFile(icoIcon, path.join(config.source, 'resources/win32/code.ico'));
console.error('code-recorder prepared with the standard editor layout and extension gallery.');
