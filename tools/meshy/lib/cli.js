// Shared CLI bits: a tiny argv parser and where the shared state lives.
import os from 'node:os';
import path from 'node:path';

/** MESHY_HOME overrides the shared folder (the unit tests point it at a temp dir). */
export const HOME = process.env.MESHY_HOME || path.join(os.homedir(), '.code/lanes-30/meshy');

/** `--a b --flag` → {a: 'b', flag: true, _: [...positionals]} @param {string[]} argv */
export function parseArgs(argv) {
	/** @type {Record<string, any>} */
	const out = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) {
			const [k, v] = a.slice(2).split('=', 2);
			if (v != null) out[k] = v;
			else if (argv[i + 1] != null && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
			else out[k] = true;
		} else out._.push(a);
	}
	return out;
}

/** @param {string} msg @param {number} [code] */
export function die(msg, code = 2) {
	console.error(msg);
	process.exit(code);
}
