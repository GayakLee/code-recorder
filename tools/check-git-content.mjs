import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const blocked = /(^|\/)(node_modules|source|tmp|outputs|\.docs|\.codex|\.ai|\.git)(\/|$)|\.(md|exe|dll|pdb|lnk|mp4|webm|wav|log|pem|key|pfx|p12|kdbx)$/i;
const local = /(^|\/)(runtime(?:\.local)?\.json|mcp-config\.json|\.env(?:\..*)?|credentials[^/]*|secrets[^/]*)$/i;
let issues = 0;
const publicFiles = new Set(['README.md', 'THIRD_PARTY_NOTICES.md', 'media/README.md', 'media/intro.mp4']);
for (const name of new Set(paths)) {
  if ((blocked.test(name) && !publicFiles.has(name)) || local.test(name)) { console.error(`Excluded file is tracked: ${name}`); issues++; continue; }
  const file = path.join(root, name); const info = await stat(file);
  if (info.size > 5 * 1024 * 1024) { console.error(`Review large file: ${name}`); issues++; continue; }
  const data = await readFile(file); if (data.includes(0)) continue;
  const text = data.toString('utf8');
  const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
  const credential = /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,})\b/;
  const profile = /[A-Za-z]:[\\/]Users[\\/][^\s"'<>]+|\/Users\/[^/\s]+|\/home\/[^/\s]+/;
  if (privateKey.test(text) || credential.test(text) || profile.test(text) || text.toLowerCase().includes(userInfo().username.toLowerCase())) {
    console.error(`Review private content: ${name}`); issues++;
  }
}
console.log(`Checked ${paths.length} Git candidate files; ${issues} issue(s). No content or credentials were printed.`);
process.exitCode = issues ? 1 : 0;
