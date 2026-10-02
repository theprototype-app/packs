// cover.webp: a 3 × 3 grid of the kit's thumbnails (512²)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TOOLS } from '../anim/anim.mjs';

const sharp = (await import(pathToFileURL(createRequire(path.join(TOOLS, 'package.json')).resolve('sharp')).href)).default;
const PACK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../interactive-kit');
const pick = ['DoorWood', 'IronGate', 'Chest', 'Portcullis', 'DoorStudded', 'Drawers', 'Lever', 'Shutters', 'Torch'];
const cell = 170;
const comps = await Promise.all(
	pick.map(async (n, i) => ({
		input: await sharp(path.join(PACK, n, 'screenshot/screenshot.webp')).resize(cell, cell).toBuffer(),
		left: 1 + (i % 3) * cell,
		top: 1 + Math.floor(i / 3) * cell
	}))
);
await sharp({ create: { width: 512, height: 512, channels: 3, background: '#d8d4cc' } }).composite(comps).webp({ quality: 82 }).toFile(path.join(PACK, 'cover.webp'));
console.log('cover.webp', fs.statSync(path.join(PACK, 'cover.webp')).size);
