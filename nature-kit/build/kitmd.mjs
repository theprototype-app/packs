#!/usr/bin/env node
// kitmd.mjs — regenerate kit.md's item table (between the items:begin/end markers) from
// items.json + the last full finalize report. `node build/kitmd.mjs`
import fs from 'node:fs';
import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PACK = path.resolve(HERE, '..');
const spec = JSON.parse(fs.readFileSync(path.join(HERE, 'items.json'), 'utf8')).items;
const rep = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(HERE, 'last-report.json'), 'utf8')).map((r) => [r.name, r]));
const seen = {};
const lines = ['| item | kind | tris | size x × y × z (m) | GLB |', '|---|---|---:|---|---:|'];
for (const it of spec) {
	const r = rep[it.name];
	let kind;
	if (it.kind === 'meshy') {
		if (!seen[it.job]) {
			seen[it.job] = it.name;
			kind = 'Meshy' + (it.grade ? ' (graded)' : '');
		} else {
			const base = spec.find((s) => s.name === seen[it.job]);
			kind = JSON.stringify(base.post.dims) !== JSON.stringify(it.post.dims) ? `size of ${seen[it.job]}` : `grade of ${seen[it.job]}`;
		}
	} else if (it.kind === 'kitbash') kind = `kitbash (${[...new Set(it.parts.map((p) => p.item))].join(', ')})`;
	else kind = `procedural (${it.script})`;
	const size = r.kb >= 1000 ? `${(r.kb / 1024).toFixed(2)} MB` : `${r.kb} KB`;
	lines.push(`| ![](${it.name}/thumb.webp) **${it.label}** \`${it.name}\` | ${kind} | ${r.tris.toLocaleString('en')} | ${r.size.map((v) => v.toFixed(2)).join(' × ')} | ${size} |`);
}
const all = Object.values(rep);
lines.push('', `All ${spec.length} GLBs together: ${(all.reduce((a, r) => a + r.kb, 0) / 1024).toFixed(1)} MB; the largest is ${Math.max(...all.map((r) => r.kb))} KB (share cap 5 MB, aim 2 MB); the heaviest tree ${Math.max(...all.map((r) => r.tris)).toLocaleString('en')} tris (budget 15k).`);
const md = fs.readFileSync(path.join(PACK, 'kit.md'), 'utf8');
const out = md.replace(/(<!-- items:begin[^>]*-->\n)[\s\S]*?(\n<!-- items:end -->)/, `$1${lines.join('\n')}$2`);
fs.writeFileSync(path.join(PACK, 'kit.md'), out);
console.log(out === md ? 'kit.md unchanged' : 'kit.md item table regenerated');
