import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function findEdgePath() {
  const where = spawnSync('where', ['msedge'], { encoding: 'utf8' });
  if (where.status === 0) {
    const first = where.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => !!line);
    if (first) return first;
  }

  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const edgePath = findEdgePath();
if (!edgePath) {
  console.error('[test:ng:edge] Could not find Microsoft Edge.');
  console.error('[test:ng:edge] Install Edge or set CHROME_BIN manually.');
  process.exit(1);
}

const extraArgs = process.argv.slice(2);
const ngArgs = ['ng', 'test', '--watch=false', '--browsers=ChromeHeadless', ...extraArgs];

const child = spawn('npx', ngArgs, {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    CHROME_BIN: edgePath
  }
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
