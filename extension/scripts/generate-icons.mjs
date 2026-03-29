#!/usr/bin/env node
/**
 * Generates extension icons (16x16, 48x48, 128x128) from an inline SVG.
 * Run: node scripts/generate-icons.mjs
 */

import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'icons');

mkdirSync(iconsDir, { recursive: true });

/**
 * SVG icon: dark rounded background (#1a1a2e) with two overlapping play
 * triangles in purple (#a78bfa) offset horizontally to suggest sync.
 */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="24" ry="24" fill="#1a1a2e"/>
  <!-- Left play triangle -->
  <polygon points="24,32 24,96 72,64" fill="#a78bfa" opacity="0.7"/>
  <!-- Right play triangle (offset right) -->
  <polygon points="56,32 56,96 104,64" fill="#a78bfa"/>
</svg>`;

const svgBuffer = Buffer.from(svg);

for (const size of [16, 48, 128]) {
  const outPath = join(iconsDir, `icon${size}.png`);
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`Generated ${outPath}`);
}

console.log('Done.');
