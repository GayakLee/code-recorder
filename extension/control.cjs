// Copyright (c) 2026 GayakLee and code-recorder contributors. MIT licensed.
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');

function editorState() {
  const editor = vscode.window.activeTextEditor;
  return {
    workspaceFolders: (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath),
    documents: vscode.workspace.textDocuments.map(d => ({ uri: d.uri.toString(), language: d.languageId, dirty: d.isDirty, untitled: d.isUntitled })),
    active: editor ? { uri: editor.document.uri.toString(), line: editor.selection.active.line + 1, column: editor.selection.active.character + 1, visibleRanges: editor.visibleRanges.map(r => ({ startLine: r.start.line + 1, endLine: r.end.line + 1 })) } : null,
  };
}
async function workspaceFile(relative, allowRoot = false) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || folder.uri.scheme !== 'file') throw new Error('A local workspace folder is required');
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => !p || p === '..' || p.includes(':'))) throw new Error('Use a relative workspace path without traversal');
  const base = await fs.realpath(folder.uri.fsPath);
  const file = path.resolve(base, relative);
  if (allowRoot && file === base) return base;
  if (!file.startsWith(base + path.sep)) throw new Error('Path escapes workspace');
  // Reject link components before reading or creating a file outside the workspace.
  let current = base;
  for (const component of path.relative(base, file).split(path.sep)) {
    current = path.join(current, component);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Linked paths are not supported'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return file;
}
async function editorAction(input, onKey = () => {}) {
  if (input.op === 'project') {
    const recent = await vscode.commands.executeCommand('_workbench.getRecentlyOpened');
    const projects = [];
    for (const entry of recent?.workspaces || []) {
      const value = entry.folderUri || entry.workspace?.configPath;
      if (!value || value.scheme !== 'file') continue;
      const uri = typeof value === 'string' ? vscode.Uri.parse(value) : vscode.Uri.from(value);
      projects.push({ path: uri.fsPath, label: entry.label || path.basename(uri.fsPath), kind: entry.folderUri ? 'folder' : 'workspace' });
    }
    for (const folder of vscode.workspace.workspaceFolders || []) if (!projects.some(p => p.path.toLowerCase() === folder.uri.fsPath.toLowerCase())) projects.unshift({ path: folder.uri.fsPath, label: folder.name, kind: 'folder' });
    const action = input.action ?? 'list';
    if (!['list', 'show', 'hide', 'explorer', 'current'].includes(action)) throw new Error('Unknown project action');
    if (action === 'show') { void vscode.commands.executeCommand('workbench.action.openRecent').then(undefined, () => {}); await sleep(150); }
    if (action === 'hide') await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    if (action === 'explorer') await vscode.commands.executeCommand('workbench.view.explorer');
    return { ...editorState(), projects };
  }
  if (input.op === 'zoom') {
    const steps = input.steps ?? 1;
    if (!['ui', 'editor'].includes(input.target) || !['in', 'out', 'reset'].includes(input.action) || !Number.isInteger(steps) || steps < 1 || steps > 10) throw new Error('Use target ui/editor, action in/out/reset and 1-10 steps');
    if (input.target === 'editor') {
      const editor = vscode.window.activeTextEditor;
      if (!editor) throw new Error('Open a document before changing editor font zoom');
      await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false });
    }
    const commands = input.target === 'ui'
      ? { in: 'workbench.action.zoomIn', out: 'workbench.action.zoomOut', reset: 'workbench.action.zoomReset' }
      : { in: 'editor.action.fontZoomIn', out: 'editor.action.fontZoomOut', reset: 'editor.action.fontZoomReset' };
    for (let i = 0; i < (input.action === 'reset' ? 1 : steps); i++) await vscode.commands.executeCommand(commands[input.action]);
    return { ...editorState(), zoom: { target: input.target, action: input.action, steps: input.action === 'reset' ? 1 : steps } };
  }
  if (input.op === 'file') {
    const file = await workspaceFile(input.path, input.action === 'list');
    if (input.action === 'list') {
      const entries = await fs.readdir(file, { withFileTypes: true });
      return { path: file, entries: entries.slice(0, 500).map(e => ({ name: e.name, type: e.isSymbolicLink() ? 'link' : e.isDirectory() ? 'directory' : 'file' })), truncated: entries.length > 500 };
    }
    const uri = vscode.Uri.file(file);
    if (input.action === 'create') {
      if (typeof input.text !== 'string' || input.text.length > 100000) throw new Error('File text must be a string of at most 100000 characters');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, input.text, { flag: 'wx' });
    } else if (!['open', 'read', 'save'].includes(input.action)) throw new Error('Unknown file action');
    const document = await vscode.workspace.openTextDocument(uri);
    if (input.action === 'save') {
      if (!await document.save()) throw new Error('File save was declined');
    }
    if (input.action !== 'read') await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });
    return { path: file, uri: document.uri.toString(), text: input.action === 'read' ? document.getText() : undefined, dirty: document.isDirty };
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error('Open a document before editor actions');
  if (input.op === 'scroll') {
    const mode = input.mode ?? 'lines'; const amount = input.amount ?? 1; const duration = input.durationMs ?? 0;
    if (!['lines', 'pages', 'toLine', 'top', 'bottom'].includes(mode) || !Number.isInteger(amount) || Math.abs(amount) > 10000 || !Number.isInteger(duration) || duration < 0 || duration > 10000) throw new Error('Invalid scroll mode, amount or duration');
    if (mode === 'toLine' && (!Number.isInteger(input.line) || input.line < 1)) throw new Error('toLine requires a positive line number');
    const start = editor.visibleRanges[0]?.start.line || 0;
    const page = Math.max(1, (editor.visibleRanges[0]?.end.line ?? start + 20) - start);
    let end = mode === 'top' ? 0 : mode === 'bottom' ? editor.document.lineCount - 1 : mode === 'toLine' ? input.line - 1 : start + amount * (mode === 'pages' ? page : 1);
    end = Math.max(0, Math.min(editor.document.lineCount - 1, end));
    const steps = duration ? Math.max(1, Math.ceil(duration / 16)) : 1;
    const config = vscode.workspace.getConfiguration('editor', editor.document.uri);
    const originalSmoothing = config.inspect('smoothScrolling')?.globalValue;
    const temporarySmoothing = duration > 0 && (process.env.CODE_RECORDER_HEADLESS ?? process.env.VSCODE_RECORD_HEADLESS) === '1' && !config.get('smoothScrolling', false);
    if (temporarySmoothing) await config.update('smoothScrolling', true, vscode.ConfigurationTarget.Global);
    try {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps; const eased = t * t * (3 - 2 * t);
        const line = Math.round(start + (end - start) * eased);
        const position = new vscode.Position(line, 0);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
        if (duration) await sleep(duration / steps);
      }
      await sleep(150);
    } finally {
      if (temporarySmoothing) await config.update('smoothScrolling', originalSmoothing, vscode.ConfigurationTarget.Global);
    }
  } else if (input.op === 'type') {
    const delay = input.delayMs ?? 70;
    if (typeof input.text !== 'string' || input.text.length > 30000 || !Number.isFinite(delay) || delay < 0 || delay > 1000 || Array.from(input.text).length * delay > 240000) throw new Error('Invalid text or typing duration');
    for (const char of Array.from(input.text.replace(/\r\n?/g, '\n'))) {
      const start = editor.document.offsetAt(editor.selection.start);
      if (!await editor.edit(edit => edit.replace(editor.selection, char), { undoStopBefore: false, undoStopAfter: false })) throw new Error('Editor rejected typing');
      const position = editor.document.positionAt(start + (char === '\n' && editor.document.eol === vscode.EndOfLine.CRLF ? 2 : char.length));
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));
      onKey(char);
      if (delay) await sleep(delay);
    }
  } else if (input.op === 'cursor') {
    if (input.action === 'scroll') {
      if (!Number.isInteger(input.lines) || Math.abs(input.lines) > 10000) throw new Error('Invalid scroll distance');
      await vscode.commands.executeCommand('editorScroll', { to: input.lines < 0 ? 'up' : 'down', by: 'line', value: Math.abs(input.lines), revealCursor: false });
    } else {
      if (!['move', 'select'].includes(input.action) || !Number.isInteger(input.line) || input.line < 1 || !Number.isInteger(input.column ?? 1) || (input.column ?? 1) < 1 || !Number.isInteger(input.endLine ?? input.line) || (input.endLine ?? input.line) < 1) throw new Error('Invalid cursor position');
      const start = editor.document.validatePosition(new vscode.Position(input.line - 1, (input.column ?? 1) - 1));
      const end = input.action === 'select' ? editor.document.lineAt(Math.min((input.endLine ?? input.line) - 1, editor.document.lineCount - 1)).range.end : start;
      editor.selection = new vscode.Selection(start, end);
      editor.revealRange(new vscode.Range(start, end));
    }
  } else throw new Error('Unknown editor operation');
  return editorState();
}
module.exports = { editorState, editorAction };
