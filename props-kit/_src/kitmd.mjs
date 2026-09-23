// Regenerate the item table in ../kit.md from build-report.json (between the markers).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEMS } from './items.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(fs.readFileSync(path.join(HERE, 'build-report.json'), 'utf8'));
const pivotOf = (name) =>
	({
		WallTorch: 'bottom-centre-back (wall)',
		WallButton: 'bottom-centre-back (wall)',
		Tapestry: 'bottom-centre-back (wall)',
		Hatch: 'hinge: back edge, rotate X',
		LeverHandle: 'hinge axle, rotate X',
		DoorKey: 'centre (pickup)'
	})[name] ?? 'bottom-centre';
const src = (i) => (i.src.meshy || i.src.budget ? (i.variantOf ? `Meshy (size variant of ${i.variantOf})` : 'Meshy') : i.src.proc ? 'procedural' : 'kitbash');
const rows = ITEMS.map((i) => {
	const r = report[i.name];
	if (!r) return `| ${i.label} | \`${i.name}\` | — | — | — | — | — |`;
	return `| ${i.label} | \`${i.name}\` | ${r.size.map((v) => v.toFixed(2)).join(' × ')} | ${r.tris} | ${Math.round(r.bytes / 1024)} KB | ${pivotOf(i.name)} | ${src(i)} |`;
});
const table = ['| Item | Folder | Size x × y × z (m) | Tris | GLB | Pivot | Source |', '|---|---|---|---|---|---|---|', ...rows].join('\n');
const file = path.join(HERE, '..', 'kit.md');
const md = fs.readFileSync(file, 'utf8');
const out = md.replace(/<!-- items:start -->[\s\S]*<!-- items:end -->/, `<!-- items:start -->\n${table}\n<!-- items:end -->`);
fs.writeFileSync(file, out);
const total = Object.values(report).reduce((a, r) => a + r.bytes, 0);
console.log(`kit.md: ${rows.length} rows, ${(total / 1024 / 1024).toFixed(2)} MB of GLBs`);
