// Compiles src/main/helpers/WindowsHelper.cs into build/windows-helper.exe using
// the C# compiler that ships with Windows (.NET Framework 4.x) — no extra tools.
//
// Runs automatically before `npm start` / `npm run dev` (see package.json) and
// only recompiles when the .cs file is newer than the .exe. If it can't build
// (e.g. not Windows), it warns and exits 0: the pet still runs, just without
// desktop icons and app awareness.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'src', 'main', 'helpers', 'WindowsHelper.cs');
const output = path.join(root, 'build', 'windows-helper.exe');

function warn(message) {
  console.warn(`[build-helper] ${message}`);
  process.exit(0);
}

if (process.platform !== 'win32') warn('Not on Windows: skipping the Windows helper.');

const upToDate = fs.existsSync(output) && fs.statSync(output).mtimeMs >= fs.statSync(source).mtimeMs;
if (upToDate && !process.argv.includes('--force')) process.exit(0);

const frameworkDirs = ['Framework64', 'Framework'].map((dir) => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET', dir, 'v4.0.30319'));
const compiler = frameworkDirs.map((dir) => path.join(dir, 'csc.exe')).find((file) => fs.existsSync(file));
if (!compiler) warn('C# compiler (csc.exe) not found: desktop icons and app awareness will be unavailable.');

fs.mkdirSync(path.dirname(output), { recursive: true });
try {
  execFileSync(compiler, [
    '/nologo', '/optimize+', '/target:winexe', '/platform:anycpu',
    `/out:${output}`, source,
  ], { stdio: 'pipe', encoding: 'utf8' });
  console.log(`[build-helper] Built ${path.relative(root, output)}`);
} catch (err) {
  warn(`Compiling the Windows helper failed:\n${err.stdout || err.message}`);
}
