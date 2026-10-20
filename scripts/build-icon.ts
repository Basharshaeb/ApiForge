/**
 * Renders assets/icon.svg with Electron's own Chromium and writes the icon
 * set: PNGs at every common size, a multi-size Windows .ico and a macOS .icns.
 *
 *   npm run icon   (= electron dist/scripts/build-icon.js)
 */
import { app, BrowserWindow, type NativeImage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const ICNS_TYPES: Array<[string, number]> = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];

function buildIco(frames: Array<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  const dir = Buffer.alloc(16 * frames.length);
  let offset = 6 + dir.length;
  frames.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...frames.map((f) => f.png)]);
}

function buildIcns(frames: Array<{ type: string; png: Buffer }>): Buffer {
  const chunks = frames.map(({ type, png }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([head, png]);
  });
  const total = 8 + chunks.reduce((n, c) => n + c.length, 0);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(total, 4);
  return Buffer.concat([head, ...chunks]);
}

async function renderSvg(svg: string): Promise<NativeImage> {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent;width:1024px;height:1024px;overflow:hidden}svg{display:block}</style></head><body>${svg}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 600));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  return image.getSize().width === 1024 ? image : image.resize({ width: 1024, height: 1024, quality: 'best' });
}

function writeIconSet(image: NativeImage): void {
  const pngBySize: Record<number, Buffer> = {};
  PNG_SIZES.forEach((size) => {
    const png = (size === 1024 ? image : image.resize({ width: size, height: size, quality: 'best' })).toPNG();
    pngBySize[size] = png;
    fs.writeFileSync(path.join(ASSETS, `icon-${size}.png`), png);
  });
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), pngBySize[512]);
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), buildIco(ICO_SIZES.map((size) => ({ size, png: pngBySize[size] }))));
  fs.writeFileSync(path.join(ASSETS, 'icon.icns'), buildIcns(ICNS_TYPES.map(([type, size]) => ({ type, png: pngBySize[size] }))));
}

app.whenReady().then(async () => {
  const image = await renderSvg(fs.readFileSync(path.join(ASSETS, 'icon.svg'), 'utf8'));
  writeIconSet(image);
  const bitmap = image.toBitmap();
  const alphaAt = (x: number, y: number): number => bitmap[(y * 1024 + x) * 4 + 3];
  console.log(JSON.stringify({ captured: image.getSize(), cornerAlpha: alphaAt(2, 2), centreAlpha: alphaAt(512, 512), files: fs.readdirSync(ASSETS) }));
  app.exit(0);
}).catch((err) => { console.error(err); app.exit(1); });
