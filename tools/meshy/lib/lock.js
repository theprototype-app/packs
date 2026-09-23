// A REAL flock(2), shared with shell users (`flock ledger.jsonl …`). Node has no
// flock binding, so a child `flock -w <s> <file> sh -c 'echo locked; cat >/dev/null'`
// holds the lock for us: it prints `locked` once it owns it, and it keeps it until we
// close its stdin. If this process dies the pipe closes, the child exits and the kernel
// drops the lock — a crashed generation can never wedge every other lane.
import { spawn } from 'node:child_process';

/**
 * Run `fn` while holding an exclusive flock on `file`.
 * @template T
 * @param {string} file
 * @param {() => Promise<T> | T} fn
 * @param {{ waitSeconds?: number }} [opts]
 * @returns {Promise<T>}
 */
export async function withFlock(file, fn, { waitSeconds = 120 } = {}) {
	const child = spawn('flock', ['-w', String(waitSeconds), file, 'sh', '-c', 'echo locked; cat >/dev/null'], {
		stdio: ['pipe', 'pipe', 'inherit']
	});
	await new Promise((resolve, reject) => {
		let out = '';
		child.stdout.on('data', (d) => {
			out += d;
			if (out.includes('locked')) resolve(undefined);
		});
		child.on('error', reject);
		child.on('exit', (code) => reject(new Error(`flock on ${file} failed (exit ${code}) — timed out after ${waitSeconds}s?`)));
	});
	try {
		return await fn();
	} finally {
		child.removeAllListeners('exit');
		const done = new Promise((r) => child.once('exit', r));
		child.stdin.end();
		await done;
	}
}
