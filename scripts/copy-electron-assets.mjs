// Copy non-TS Electron assets (e.g. icon.png) into electron/.dist so runtime can load them via __dirname lookup.
// Cross-platform Node script.
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

async function run() {
  const root = process.cwd();
  const srcDir = path.join(root, 'electron');
  const outDir = path.join(srcDir, '.dist');
  const files = ['icon.png'];
  try { await mkdir(outDir, { recursive: true }); } catch {}
  for (const f of files) {
    const from = path.join(srcDir, f);
    const to = path.join(outDir, f);
    try {
      await copyFile(from, to);
      console.log(`[copy-electron-assets] copied ${f}`);
    } catch (e) {
      console.warn(`[copy-electron-assets] failed copying ${f}`, e);
    }
  }
}
run().catch(e => { console.error('[copy-electron-assets] unexpected error', e); process.exit(1); });
