// report: the check's findings for a terminal and a GitHub step summary, and the BUDGET REPORT —
// every item against its category budget, its bytes, textures, LOD levels and z-fight area.

/** @param {any[]} findings @returns {number} errors that are not allow-listed */
export function printFindings(findings) {
	const order = { error: 0, warn: 1 };
	const sorted = [...findings].sort((a, b) => (a.allowed ? 1 : 0) - (b.allowed ? 1 : 0) || order[a.level] - order[b.level] || a.pack.localeCompare(b.pack) || a.item.localeCompare(b.item));
	let errors = 0;
	let allowed = 0;
	let warns = 0;
	for (const f of sorted) {
		const where = `${f.pack}/${f.item}`.padEnd(34);
		if (f.allowed) {
			allowed++;
			if (process.env.KIT_VERBOSE) console.log(`allowed ${where} [${f.check}] ${f.msg}\n        ↳ ${f.allowed}`);
		} else if (f.level === 'error') {
			errors++;
			console.log(`ERROR   ${where} [${f.check}] ${f.msg}`);
		} else {
			warns++;
			console.log(`warn    ${where} [${f.check}] ${f.msg}`);
		}
	}
	console.log(`\n${errors} error(s), ${warns} warning(s), ${allowed} allow-listed (KIT_VERBOSE=1 lists them with their reasons)`);
	return errors;
}

/** markdown for $GITHUB_STEP_SUMMARY @param {{findings: any[], items: any[]}} r */
export function summaryMarkdown(r) {
	const errors = r.findings.filter((f) => f.level === 'error' && !f.allowed);
	const warns = r.findings.filter((f) => f.level === 'warn');
	const allowed = r.findings.filter((f) => f.allowed);
	const row = (/** @type {any} */ f) => `| ${f.pack} | ${f.item} | ${f.check} | ${String(f.msg).replace(/\|/g, '\\|')} |`;
	const lines = [
		`## Pack checks — ${errors.length ? `❌ ${errors.length} error(s)` : '✅ pass'}`,
		'',
		`${r.items.length} items · ${errors.length} errors · ${warns.length} warnings · ${allowed.length} allow-listed`,
		''
	];
	if (errors.length) lines.push('| pack | item | check | problem |', '|---|---|---|---|', ...errors.map(row), '');
	if (warns.length) lines.push('<details><summary>warnings</summary>', '', '| pack | item | check | note |', '|---|---|---|---|', ...warns.map(row), '', '</details>', '');
	if (allowed.length)
		lines.push('<details><summary>allow-listed</summary>', '', '| pack | item | check | reason |', '|---|---|---|---|', ...allowed.map((f) => `| ${f.pack} | ${f.item} | ${f.check} | ${String(f.allowed).replace(/\|/g, '\\|')} |`), '', '</details>', '');
	return lines.join('\n') + '\n';
}

/** the budget report @param {{findings: any[], items: any[]}} r */
export function budgetMarkdown(r) {
	const out = ['# Pack budget report', '', 'LOD0 triangles against the item\'s category budget (tools/kit-build/packs.json), bytes, largest texture, LOD levels (triangles), static z-fight area.', ''];
	const byPack = new Map();
	for (const it of r.items) {
		if (!byPack.has(it.pack)) byPack.set(it.pack, []);
		byPack.get(it.pack).push(it);
	}
	for (const [pack, items] of byPack) {
		const tris = items.reduce((/** @type {number} */ s, /** @type {any} */ i) => s + i.tris, 0);
		const bytes = items.reduce((/** @type {number} */ s, /** @type {any} */ i) => s + i.bytes + i.lods.reduce((/** @type {number} */ a, /** @type {any} */ l) => a + l.bytes, 0), 0);
		const errs = r.findings.filter((f) => f.pack === pack && f.level === 'error' && !f.allowed).length;
		out.push(`## ${pack} — ${items.length} items, ${(bytes / 1048576).toFixed(1)} MiB, ${tris.toLocaleString('en')} LOD0 triangles${errs ? `, **${errs} errors**` : ''}`, '');
		out.push('| item | category | tris / budget | MiB | texture | LODs | z-fight cm² |', '|---|---|---|---|---|---|---|');
		for (const i of items) {
			const pct = i.budget ? Math.round((100 * i.tris) / i.budget) : 0;
			const tex = Math.max(0, ...i.textures.map((/** @type {any} */ t) => Math.max(...(t.size ?? [0]))));
			const lods = i.lods.length ? i.lods.map((/** @type {any} */ l) => l.tris).join(' / ') : '—';
			out.push(`| ${i.item} | ${i.category ?? '?'} | ${i.tris} / ${i.budget ?? '?'} (${pct} %) | ${(i.bytes / 1048576).toFixed(2)} | ${tex || '—'} | ${lods} | ${i.flickerCm2 ?? '—'} |`);
		}
		out.push('');
	}
	return out.join('\n') + '\n';
}
