// The thin Meshy REST client. The key comes from the environment ONLY (load it with
// `set -a; . ~/.config/theprototype/meshy.env; set +a`) and is never logged: it lives in
// one header, never in a URL, and every error message is built from status + body.
//
// Retry policy — the part that protects the credits:
//   GET                      retried on anything transient (network, 429, 5xx)
//   create POST, 429         NOT accepted → wait (Retry-After / backoff) and retry
//   create POST, refused     connection refused / DNS: never reached Meshy → retry
//   create POST, other 4xx   DefiniteError (not charged; the ledger releases)
//   create POST, 5xx/timeout/reset
//                            AmbiguousError — Meshy MAY have created (and charged) the
//                            task. Never blindly re-POST: gen.js adopts it from the list.
export const BASE = process.env.MESHY_BASE_URL || 'https://api.meshy.ai';

export class DefiniteError extends Error {
	/** @param {string} m @param {number} [status] @param {any} [body] */
	constructor(m, status, body) {
		super(m);
		this.status = status;
		this.body = body;
	}
}
export class AmbiguousError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function key() {
	const k = process.env.MESHY_API_KEY;
	if (!k) throw new DefiniteError('MESHY_API_KEY is not set — run: set -a; . ~/.config/theprototype/meshy.env; set +a');
	return k;
}

/** Scrub anything key-shaped from text before it is printed or saved. @param {string} s */
export function scrub(s) {
	const k = process.env.MESHY_API_KEY;
	let out = String(s);
	if (k) out = out.split(k).join('[KEY]');
	return out.replace(/msy_[A-Za-z0-9_-]{8,}/g, 'msy_[KEY]').replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [KEY]');
}

/** @param {Response} res */
async function bodyOf(res) {
	const t = await res.text();
	try {
		return JSON.parse(t);
	} catch {
		return t;
	}
}

function retryAfterMs(res, attempt) {
	const h = res?.headers?.get?.('retry-after');
	const s = h ? Number(h) : NaN;
	if (Number.isFinite(s) && s >= 0) return Math.min(60_000, s * 1000 + 250);
	return Math.min(60_000, 1000 * 2 ** attempt + Math.random() * 500);
}

/** network errors that mean the request never left this machine */
function neverSent(err) {
	const c = err?.cause?.code ?? err?.code;
	return c === 'ECONNREFUSED' || c === 'ENOTFOUND' || c === 'EAI_AGAIN' || c === 'ENETUNREACH';
}

/** @param {string} path @param {{tries?: number, fetchImpl?: typeof fetch}} [o] */
export async function get(path, { tries = 8, fetchImpl = fetch } = {}) {
	let last;
	for (let attempt = 0; attempt < tries; attempt++) {
		let res;
		try {
			res = await fetchImpl(BASE + path, { headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(30_000) });
		} catch (err) {
			if (err instanceof DefiniteError) throw err;
			last = err;
			await sleep(retryAfterMs(null, attempt));
			continue;
		}
		if (res.ok) return bodyOf(res);
		const body = await bodyOf(res);
		if (res.status === 429 || res.status >= 500) {
			last = new Error(`GET ${path} → ${res.status}`);
			await sleep(retryAfterMs(res, attempt));
			continue;
		}
		throw new DefiniteError(scrub(`GET ${path} → ${res.status} ${JSON.stringify(body)}`), res.status, body);
	}
	throw new Error(scrub(`GET ${path} failed after ${tries} tries: ${last?.message ?? last}`));
}

/**
 * The create POST (the one call that spends credits). Returns the new task id.
 * @param {string} path @param {object} payload @param {{tries?: number, fetchImpl?: typeof fetch, log?: (s: string) => void}} [o]
 */
export async function create(path, payload, { tries = 6, fetchImpl = fetch, log = () => {} } = {}) {
	for (let attempt = 0; attempt < tries; attempt++) {
		let res;
		try {
			res = await fetchImpl(BASE + path, {
				method: 'POST',
				headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(60_000)
			});
		} catch (err) {
			if (err instanceof DefiniteError) throw err;
			if (neverSent(err)) {
				log(`POST ${path}: ${err?.cause?.code ?? err.message} (never sent) — retrying`);
				await sleep(retryAfterMs(null, attempt));
				continue;
			}
			throw new AmbiguousError(scrub(`POST ${path}: ${err?.cause?.code ?? err?.name ?? ''} ${err.message}`));
		}
		const body = await bodyOf(res);
		if (res.ok) {
			const id = body?.result ?? body?.id;
			if (!id) throw new AmbiguousError(scrub(`POST ${path} → ${res.status} without a task id: ${JSON.stringify(body)}`));
			return String(id);
		}
		if (res.status === 429) {
			const ms = retryAfterMs(res, attempt);
			log(`POST ${path}: 429 rate-limited — waiting ${Math.round(ms / 1000)}s`);
			await sleep(ms);
			continue;
		}
		if (res.status >= 500) throw new AmbiguousError(scrub(`POST ${path} → ${res.status} ${JSON.stringify(body)}`));
		throw new DefiniteError(scrub(`POST ${path} → ${res.status} ${JSON.stringify(body)}`), res.status, body);
	}
	throw new DefiniteError(`POST ${path}: still rate-limited / unreachable after ${tries} tries (nothing was created)`);
}

/** Download a (signed, expiring) asset URL to a Buffer. Asset URLs carry no key. @param {string} url */
export async function download(url, { tries = 5, fetchImpl = fetch } = {}) {
	let last;
	for (let attempt = 0; attempt < tries; attempt++) {
		try {
			const res = await fetchImpl(url, { signal: AbortSignal.timeout(180_000) });
			if (res.ok) return Buffer.from(await res.arrayBuffer());
			last = new Error(`download → ${res.status}`);
			if (res.status < 500 && res.status !== 429) break;
		} catch (err) {
			last = err;
		}
		await sleep(retryAfterMs(null, attempt));
	}
	throw new Error(`download failed: ${last?.message ?? last}`);
}

export const balance = async () => /** @type {any} */ (await get('/openapi/v1/balance')).balance;
