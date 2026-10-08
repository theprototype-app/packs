#!/usr/bin/env node
// kit-build — THE pack build tool (roadmap 34 E2). One command line for every step a pack goes
// through after its recipe made the GLBs; the per-kit forks of these steps are gone (see README.md).
//
//   node tools/kit-build/kit-build.mjs <command> …       (deps: cd tools/meshy && npm ci)
//
//   build  <pack> [--only A,B] [--no-thumbs]   run the pack's recipe, then lod + thumbs + report
//   post   <raw.glb> <out.glb> '<job json>'     the one post step on one Meshy raw (lib/post.mjs)
//   pass   <pack…|--all> [--write]             decimate to budget, texture cap, emissive policy on
//                                               the SHIPPED GLBs (dry run unless --write; a compliant
//                                               file is left byte-identical)
//   lod    <pack>                               defight (judged) + LOD1/LOD2 + --check (tools/lod)
//   thumbs <pack> [--only A,B]                  render each row's screenshot (512², tools/meshy)
//   flicker <pack…|--all> [--record]           static z-fight probe; --record renders every file over
//                                               the limit (headless) and writes flicker-baseline.json
//   report [pack…] [--md file] [--json file]   the budget report (tris vs budget, MiB, textures, LODs)
//   check  [pack…] [--json file] [--summary file]   the CI: exit 1 on any error not in allow.json
//   dims   [pack…|--all] [--write] [--remote]   measure each row's size/box/tris/bytes/animated and
//                                               write them onto the row (core 39 P4: the app's
//                                               drag-to-place ghost reads them before any download);
//                                               --remote downloads absolute-URL rows (Khronos)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO } from './lib/deps.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (/** @type {string} */ f) => rest.includes(f);
const opt = (/** @type {string} */ f) => (rest.includes(f) ? rest[rest.indexOf(f) + 1] : null);
const positional = () => rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--md', '--json', '--summary', '--only'].includes(rest[i - 1])));

/** where each pack's recipe lives (what makes its GLBs from Meshy raws / procedural code) */
export const RECIPES = {
	'architecture-kit': ['tools/architecture-kit/build.mjs', '--no-thumbs'],
	'scifi-kit': ['tools/scifi-kit/build.mjs', '--no-thumbs'],
	'town-kit': ['tools/town-kit/build.mjs', '--no-thumbs'],
	'interactive-kit': ['tools/interactive-kit/build.mjs'],
	'nature-kit': ['nature-kit/build/finalize.mjs', '--no-thumbs'],
	'props-kit': ['props-kit/_src/build.mjs', '--no-shots'],
	'interior-kit': ['interior-kit/_src/build.mjs', '--no-shots']
};

const node = (/** @type {string[]} */ args) => execFileSync(process.execPath, args, { cwd: REPO, stdio: 'inherit' });

async function main() {
	switch (cmd) {
		case 'check': {
			const { runChecks } = await import('./lib/check.mjs');
			const { printFindings, summaryMarkdown } = await import('./lib/report.mjs');
			const packs = positional();
			const t0 = Date.now();
			const r = await runChecks(REPO, { packs: packs.length ? packs : null });
			const errors = printFindings(r.findings);
			console.log(`\n${r.items.length} items checked in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
			if (opt('--json')) fs.writeFileSync(/** @type {string} */ (opt('--json')), JSON.stringify(r, null, 1) + '\n');
			if (opt('--summary')) fs.appendFileSync(/** @type {string} */ (opt('--summary')), summaryMarkdown(r));
			process.exitCode = errors ? 1 : 0;
			return;
		}
		case 'report': {
			const { runChecks } = await import('./lib/check.mjs');
			const { budgetMarkdown } = await import('./lib/report.mjs');
			const packs = positional();
			const r = await runChecks(REPO, { packs: packs.length ? packs : null });
			const md = budgetMarkdown(r);
			if (opt('--md')) fs.writeFileSync(/** @type {string} */ (opt('--md')), md);
			else process.stdout.write(md);
			if (opt('--json')) fs.writeFileSync(/** @type {string} */ (opt('--json')), JSON.stringify(r.items, null, 1) + '\n');
			return;
		}
		case 'dims': {
			const { dimsPacks } = await import('./lib/dims.mjs');
			const packs = flag('--all') ? null : positional();
			const r = await dimsPacks(REPO, packs, { write: flag('--write'), remote: flag('--remote') });
			const changed = r.reduce((n, p) => n + p.changed, 0);
			console.log(`${changed} row(s) ${flag('--write') ? 'written' : 'would change (dry run; --write to apply)'}`);
			return;
		}
		case 'post': {
			const [input, output, job] = rest;
			if (!input || !output) throw new Error("usage: kit-build post <raw.glb> <out.glb> '<job json>'");
			const { kitPost } = await import('./lib/post.mjs');
			console.log(JSON.stringify(await kitPost(input, output, JSON.parse(job || '{}'))));
			return;
		}
		case 'pass': {
			const { passPack } = await import('./lib/pass.mjs');
			const { loadConfig } = await import('./lib/check.mjs');
			const packs = flag('--all') ? Object.keys(loadConfig(REPO).packs.packs) : positional();
			if (!packs.length) throw new Error('usage: kit-build pass <pack…|--all> [--write]');
			let changed = 0;
			for (const p of packs) changed += await passPack(REPO, p, { write: flag('--write') });
			console.log(`${changed} file(s) ${flag('--write') ? 'rewritten' : 'would change (dry run; --write to apply)'}`);
			return;
		}
		case 'lod': {
			const [pack] = positional();
			if (!pack) throw new Error('usage: kit-build lod <pack>');
			node(['tools/lod/defight-all.mjs', pack]);
			node(['tools/lod/lod.mjs', pack]);
			node(['tools/lod/lod.mjs', '--check', pack]);
			return;
		}
		case 'thumbs': {
			const [pack] = positional();
			if (!pack) throw new Error('usage: kit-build thumbs <pack> [--only A,B]');
			const { thumbsPack } = await import('./lib/pass.mjs');
			const only = opt('--only')?.split(',') ?? null;
			console.log(`${await thumbsPack(REPO, pack, only)} thumbnail(s) rendered`);
			return;
		}
		case 'flicker': {
			const { flickerPacks } = await import('./lib/flicker.mjs');
			const { loadConfig } = await import('./lib/check.mjs');
			const packs = flag('--all') ? Object.keys(loadConfig(REPO).packs.packs) : positional();
			await flickerPacks(REPO, packs, { record: flag('--record') });
			return;
		}
		case 'build': {
			const [pack] = positional();
			const recipe = RECIPES[/** @type {keyof RECIPES} */ (pack)];
			if (!recipe) throw new Error(`kit-build build: no recipe for "${pack}" (have: ${Object.keys(RECIPES).join(', ')})`);
			const only = opt('--only');
			node([...recipe, ...(only ? ['--only', only] : [])]);
			const { passPack, thumbsPack } = await import('./lib/pass.mjs');
			await passPack(REPO, pack, { write: true });
			node(['tools/lod/defight-all.mjs', pack]);
			node(['tools/lod/lod.mjs', pack]);
			if (!flag('--no-thumbs')) await thumbsPack(REPO, pack, only?.split(',') ?? null);
			const { dimsPacks } = await import('./lib/dims.mjs');
			await dimsPacks(REPO, [pack], { write: true });
			node(['tools/kit-build/kit-build.mjs', 'check', pack]);
			return;
		}
		default:
			console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
			process.exitCode = cmd ? 2 : 0;
	}
}

await main();
