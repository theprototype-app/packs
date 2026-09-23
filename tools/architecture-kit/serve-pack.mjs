// Serve this packs checkout over https with CORS, so a core dev server built with
// VITE_PACKS_BASE=https://theprototype.app:<port> reads the UNPUBLISHED packs exactly
// the way it reads jsDelivr (index.json → <pack>/default.json → <item>/glTF-Binary/…).
//
//   node tools/architecture-kit/serve-pack.mjs [port=5257] [certDir=<core>/certs]
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.argv[2] || 5257);
const CERTS = process.argv[3] || '/home/deck/.code/theprototype-app/theprototype-lane-30c-arch-engine/certs';
const TYPES = { '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.html': 'text/html', '.md': 'text/markdown', '.zip': 'application/zip' };

https
	.createServer({ cert: fs.readFileSync(path.join(CERTS, 'localhost.crt')), key: fs.readFileSync(path.join(CERTS, 'localhost.key')) }, (req, res) => {
		const rel = decodeURIComponent(new URL(req.url || '/', 'https://x').pathname);
		const file = path.join(ROOT, path.normalize(rel));
		res.setHeader('Access-Control-Allow-Origin', '*');
		if (!file.startsWith(ROOT) || rel.split('/').some((p) => p.startsWith('.')) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
			res.writeHead(404).end('not found');
			return;
		}
		res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
		fs.createReadStream(file).pipe(res);
	})
	.listen(PORT, () => console.log(`packs ${ROOT} on https://theprototype.app:${PORT}/`));
