// Regenerate the item table in ../kit.md from build-report.json (between the markers).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEMS, pivotOf } from './items.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(fs.readFileSync(path.join(HERE, 'build-report.json'), 'utf8'));
const src = (i) => {
	if (i.src.meshy) return i.variantOf ? `Meshy (variant of ${i.variantOf})` : i.src.stage === 'retexture' ? 'Meshy (retextured)' : 'Meshy';
	if (i.src.proc) return 'procedural';
	return `set: ${i.src.kitbash.map((k) => k[0]).join(' + ')}`;
};
const rows = ITEMS.map((i) => {
	const r = report[i.name];
	if (!r) return `| ${i.label} | \`${i.name}\` | — | — | — | — | — | — |`;
	return `| ${i.label} | \`${i.name}\` | ${r.size.map((v) => v.toFixed(2)).join(' × ')} | ${r.tris} | ${Math.round(r.bytes / 1024)} KB | ${pivotOf(i)} | ${i.collider} | ${src(i)} |`;
});
const table = ['| Item | Folder | Size x × y × z (m) | Tris | GLB | Pivot | Collider | Source |', '|---|---|---|---|---|---|---|---|', ...rows].join('\n');
const file = path.join(HERE, '..', 'kit.md');
const md = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file, md.replace(/<!-- items:start -->[\s\S]*<!-- items:end -->/, `<!-- items:start -->\n${table}\n<!-- items:end -->`));
const total = Object.values(report).reduce((a, r) => a + r.bytes, 0);
console.log(`kit.md: ${rows.length} rows, ${(total / 1024 / 1024).toFixed(2)} MB of GLBs`);
