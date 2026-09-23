#!/usr/bin/env node
// meshy-rigged <rigged.glb> <out.glb> [--clip walking.glb=walk] [--clip anim.glb=hit,death] [--tris 8000] [--tex 1024] [--thumb t.webp] [--pbr refine.glb]
//   Merge a rigged character and its clip files into one skinned GLB (see lib/rigged.js).
//   A clip's names are one per animation in that file, in order. --pbr puts back the refine's
//   normal + metal-rough maps (rigging keeps only the base colour); --retexture <retexture raw.glb>
//   swaps in ALL maps of a retexture made with the original UVs. stdout: the JSON report.
import { die } from '../lib/cli.js';
import { postRigged } from '../lib/rigged.js';

const argv = process.argv.slice(2);
const pos = [];
const clips = [];
let targetTris, textureSize, thumb, pbrFrom, retexture = false;
for (let i = 0; i < argv.length; i++) {
	const a = argv[i];
	if (a === '--clip') {
		const [file, names] = String(argv[++i]).split('=');
		if (!file || !names) die('--clip needs file.glb=name[,name…]');
		clips.push({ file, name: names.split(',') });
	} else if (a === '--tris') targetTris = Number(argv[++i]);
	else if (a === '--tex') textureSize = Number(argv[++i]);
	else if (a === '--thumb') thumb = argv[++i];
	else if (a === '--pbr') pbrFrom = argv[++i];
	else if (a === '--retexture') {
		pbrFrom = argv[++i];
		retexture = true;
	}
	else pos.push(a);
}
if (pos.length !== 2) die('usage: meshy-rigged rigged.glb out.glb [--clip file.glb=name[,name]]… [--tris N] [--tex 1024] [--thumb t.webp]');
const report = await postRigged({ base: pos[0], out: pos[1], clips, targetTris, textureSize, pbrFrom, retexture });
if (thumb) {
	const { renderThumbs } = await import('../lib/thumb.js');
	await renderThumbs([{ glb: pos[1], out: thumb }]);
}
console.log(JSON.stringify(report, null, 2));
