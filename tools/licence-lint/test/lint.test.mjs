// The licence lint, proven red on each kind of bad input (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { lint, vrmLicenceProblems, clipLicenceProblems } from '../lint.mjs';
import { writeGlb } from '../../motion-kit/glbjson.mjs';

const vrm0 = (meta) => ({ asset: { version: '2.0' }, extensionsUsed: ['VRM'], extensions: { VRM: { meta } } });
const vrm1 = (meta) => ({ asset: { version: '2.0' }, extensionsUsed: ['VRMC_vrm'], extensions: { VRMC_vrm: { specVersion: '1.0', meta } } });
const clip = (licence, humanoid = true, hips = true) => ({
	asset: { version: '2.0' },
	extras: { theprototype: { format: 1, kind: 'clip', skeleton: { sig: 'x', humanoid }, provenance: [{ tool: 'import', licence: { id: licence } }] } },
	...(hips ? { extensions: { VRMC_vrm_animation: { humanoid: { humanBones: { hips: { node: 0 } } } } } } : {})
});

test('VRM 0.x: CC0 passes; prohibited / non-commercial / extra licence fail', () => {
	assert.deepEqual(vrmLicenceProblems(vrm0({ licenseName: 'CC0', commercialUssageName: 'Allow', otherLicenseUrl: '' })), []);
	assert.match(vrmLicenceProblems(vrm0({ licenseName: 'Redistribution_Prohibited' }))[0], /not CC0/);
	assert.match(vrmLicenceProblems(vrm0({ licenseName: 'CC0', commercialUssageName: 'Disallow' })).join(), /commercial/);
	assert.match(vrmLicenceProblems(vrm0({ licenseName: 'CC0', otherLicenseUrl: 'ipfs://x' })).join(), /another licence/);
	assert.match(vrmLicenceProblems({ asset: {} })[0], /without the VRM extension/);
});

test('VRM 1.0: only a CC0-equivalent grant passes', () => {
	const ok = { allowRedistribution: true, commercialUsage: 'corporation', modification: 'allowModificationRedistribution', creditNotation: 'unnecessary' };
	assert.deepEqual(vrmLicenceProblems(vrm1(ok)), []);
	assert.equal(vrmLicenceProblems(vrm1({ ...ok, allowRedistribution: false })).length, 1);
	assert.equal(vrmLicenceProblems(vrm1({ ...ok, creditNotation: 'required' })).length, 1);
	assert.equal(vrmLicenceProblems(vrm1({ ...ok, commercialUsage: 'personalNonProfit' })).length, 1);
});

test('.tpanim: CC0 provenance + hips pass; a CC-BY clip or a humanoid without hips fails', () => {
	assert.deepEqual(clipLicenceProblems(clip('CC0-1.0'), 'CC0-1.0'), []);
	assert.match(clipLicenceProblems(clip('CC-BY-4.0'), 'CC0-1.0').join(), /provenance says CC-BY/);
	assert.match(clipLicenceProblems(clip('CC0-1.0', true, false), 'CC0-1.0').join(), /hips/);
	assert.match(clipLicenceProblems({ asset: {} }, 'CC0-1.0').join(), /not a .tpanim/);
});

test('a pack: every file needs a CC0 record with its sha256; the index row must be CC0', () => {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-'));
	const pack = path.join(repo, 'kit');
	fs.mkdirSync(path.join(pack, 'A'), { recursive: true });
	const good = writeGlb(vrm0({ licenseName: 'CC0', commercialUssageName: 'Allow' }), Buffer.alloc(0));
	fs.writeFileSync(path.join(pack, 'A', 'a.vrm'), good);
	fs.writeFileSync(path.join(pack, 'A', 'thumb.webp'), 'x');
	const sha = crypto.createHash('sha256').update(good).digest('hex');
	const rec = { 'A/a.vrm': { licence: 'CC0-1.0', author: 'Someone', source: 'https://x', sha256: sha }, 'A/thumb.webp': { licence: 'CC0-1.0', author: 'Someone', source: 'https://x' } };
	fs.writeFileSync(path.join(pack, 'licences.json'), JSON.stringify(rec));
	fs.writeFileSync(path.join(repo, 'index.json'), JSON.stringify([{ name: 'kit', license: 'CC0-1.0' }]));
	assert.deepEqual(lint({ repo }).filter((f) => f.level === 'error'), []);
	// a file with no record
	fs.writeFileSync(path.join(pack, 'A', 'extra.png'), 'y');
	assert.match(lint({ repo }).map((f) => f.msg).join(), /no licence record/);
	fs.rmSync(path.join(pack, 'A', 'extra.png'));
	// the file changed under its pin
	fs.writeFileSync(path.join(pack, 'A', 'a.vrm'), writeGlb(vrm0({ licenseName: 'CC_BY' }), Buffer.alloc(0)));
	const msgs = lint({ repo }).map((f) => f.msg).join();
	assert.match(msgs, /sha256/);
	assert.match(msgs, /not CC0/);
	// the index row
	fs.writeFileSync(path.join(pack, 'A', 'a.vrm'), good);
	fs.writeFileSync(path.join(repo, 'index.json'), JSON.stringify([{ name: 'kit', license: 'CC-BY-4.0' }]));
	assert.match(lint({ repo }).map((f) => f.msg).join(), /CC0 only/);
	fs.rmSync(repo, { recursive: true, force: true });
});
