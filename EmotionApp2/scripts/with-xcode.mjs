import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function findDeveloperDirectory() {
  let selected = '';
  try { selected = execFileSync('xcode-select', ['-p'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  return [process.env.DEVELOPER_DIR, selected, '/Applications/Xcode.app/Contents/Developer']
    .find((candidate) => candidate && fs.existsSync(path.join(candidate, 'Platforms/iPhoneOS.platform')));
}

export function xcodeEnvironment() {
  const directory = findDeveloperDirectory();
  if (!directory) throw new Error('Full Xcode with the iPhoneOS platform is required.');
  return {
    ...process.env, DEVELOPER_DIR: directory, NODE_BINARY: process.execPath,
    PATH: [path.dirname(process.execPath), process.env.PATH || ''].join(path.delimiter),
    // Supported by the pinned llama.rn podspec; avoids unrelated simulator binaries.
    RNLLAMA_BUILD_FROM_SOURCE: process.env.RNLLAMA_BUILD_FROM_SOURCE || '1',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw new Error('Usage: node scripts/with-xcode.mjs command [arguments]');
  const child = spawn(command, args, { env: xcodeEnvironment(), stdio: 'inherit' });
  child.once('error', (error) => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', (code) => { process.exitCode = code ?? 1; });
}
