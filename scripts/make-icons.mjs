// Renders assets/icons/pet-icon.svg at every size Windows asks for and packs
// them into .ico files (tray and window icons), plus a grey "paused" variant.
//
// Run with Electron (it renders the SVG offscreen):  npm run icons
// The outputs are committed, so this only needs re-running when the art changes.

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { packIco } from './ico.mjs';

const root = path.resolve(import.meta.dirname, '..');
const svg = pathToFileURL(path.join(root, 'assets', 'icons', 'pet-icon.svg')).href;
const outDir = path.join(root, 'assets', 'icons');
// Tray: 16 (100%), 20 (125%), 24 (150%), 32 (200%); plus window/taskbar and big sizes.
const SIZES = [16, 20, 24, 32, 40, 48, 64, 256];
const VARIANTS = {
  'pet.ico': '',
  'pet-paused.ico': 'filter: grayscale(1) opacity(0.7);',
};

app.whenReady().then(async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-icons-'));
  const win = new BrowserWindow({
    width: 256, height: 256, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', webPreferences: { offscreen: true },
  });

  for (const [file, style] of Object.entries(VARIANTS)) {
    const images = [];
    for (const size of SIZES) {
      const page = path.join(scratch, `icon-${size}.html`);
      fs.writeFileSync(page, `<!doctype html><html><body style="margin:0;background:transparent">
        <img src="${svg}" style="display:block;width:${size}px;height:${size}px;${style}"></body></html>`);
      await win.loadFile(page);
      await new Promise((resolve) => setTimeout(resolve, 150));
      let image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
      if (image.getSize().width !== size) image = image.resize({ width: size, height: size, quality: 'best' });
      images.push({ size, png: image.toPNG() });
      if (file === 'pet.ico' && size === 256) fs.writeFileSync(path.join(outDir, 'pet-256.png'), image.toPNG());
    }
    fs.writeFileSync(path.join(outDir, file), packIco(images));
    console.log(`[icons] ${file}: ${SIZES.join(', ')} px`);
  }
  fs.rmSync(scratch, { recursive: true, force: true });
  app.quit();
});
