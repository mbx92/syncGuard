import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import pngToIco from 'png-to-ico';
import { readPNG, resize } from 'png-to-ico/lib/png.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pngPath = path.join(root, 'assets', 'icon.png');
const icoPath = path.join(root, 'assets', 'icon.ico');

const FILL_RATIO = 0.88;
const BLACK_THRESHOLD = 40;

if (!fs.existsSync(pngPath)) {
  console.error(`PNG not found: ${pngPath}`);
  process.exit(1);
}

function isBackground(r, g, b, a) {
  return a > 0 && r <= BLACK_THRESHOLD && g <= BLACK_THRESHOLD && b <= BLACK_THRESHOLD;
}

function stripBlackBackground(png) {
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    if (isBackground(r, g, b, png.data[i + 3])) {
      png.data[i + 3] = 0;
    }
  }
}

function findContentBounds(png) {
  let minX = png.width;
  let minY = png.height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (png.width * y + x) << 2;
      const a = png.data[i + 3];
      if (a > 20) {
        const r = png.data[i];
        const g = png.data[i + 1];
        const b = png.data[i + 2];
        if (r + g + b > 40) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
  }

  if (maxX < minX) {
    return { minX: 0, minY: 0, maxX: png.width - 1, maxY: png.height - 1 };
  }
  return { minX, minY, maxX, maxY };
}

function crop(png, minX, minY, maxX, maxY) {
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (png.width * (minY + y) + (minX + x)) << 2;
      const di = (w * y + x) << 2;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

function blitCenter(dest, src) {
  const ox = Math.floor((dest.width - src.width) / 2);
  const oy = Math.floor((dest.height - src.height) / 2);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const si = (src.width * y + x) << 2;
      const a = src.data[si + 3];
      if (a === 0) continue;
      const di = (dest.width * (oy + y) + (ox + x)) << 2;
      dest.data[di] = src.data[si];
      dest.data[di + 1] = src.data[si + 1];
      dest.data[di + 2] = src.data[si + 2];
      dest.data[di + 3] = a;
    }
  }
}

function normalizeForWindows(png) {
  const size = Math.max(png.width, png.height);
  stripBlackBackground(png);

  const bounds = findContentBounds(png);
  const cropped = crop(png, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
  stripBlackBackground(cropped);

  const target = Math.round(size * FILL_RATIO);
  const scale = Math.min(target / cropped.width, target / cropped.height);
  const newW = Math.max(1, Math.round(cropped.width * scale));
  const newH = Math.max(1, Math.round(cropped.height * scale));
  const scaled = resize(cropped, newW, newH);
  stripBlackBackground(scaled);

  const canvas = new PNG({ width: size, height: size });
  blitCenter(canvas, scaled);
  return canvas;
}

const source = await readPNG(pngPath);
const bounds = findContentBounds(source);
const fillBefore = ((bounds.maxX - bounds.minX + 1) / source.width * 100).toFixed(1);

const normalized = normalizeForWindows(source);
const normalizedPng = PNG.sync.write(normalized);
const buf = await pngToIco(normalizedPng);

fs.writeFileSync(icoPath, buf);
fs.writeFileSync(path.join(root, 'frontend', 'icon.png'), normalizedPng);
console.log(
  `Created: ${icoPath} (transparent bg, ${buf.length} bytes, fill ${fillBefore}% -> ${Math.round(FILL_RATIO * 100)}%)`
);
