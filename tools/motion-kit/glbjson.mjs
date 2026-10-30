// The JSON + BIN chunks of a GLB, read and written as they are (no glTF library): the motion-kit build
// adds what gltf-transform does not know (the VRMC_vrm_animation extension, root extras), and the
// licence lint reads each file's own statements.

/** @param {Uint8Array | Buffer} bytes @returns {{json: any, bin: Buffer}} */
export function readGlb(bytes) {
	const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
	let at = 12;
	let json = null;
	let bin = Buffer.alloc(0);
	while (at + 8 <= b.length) {
		const len = b.readUInt32LE(at);
		const type = b.readUInt32LE(at + 4);
		const body = b.subarray(at + 8, at + 8 + len);
		if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
		else if (type === 0x004e4942) bin = Buffer.from(body);
		at += 8 + len;
	}
	if (!json) throw new Error('GLB has no JSON chunk');
	return { json, bin };
}

/** @param {any} json @param {Buffer} bin @returns {Buffer} */
export function writeGlb(json, bin) {
	let j = Buffer.from(JSON.stringify(json), 'utf8');
	j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
	const B = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)]);
	const total = 12 + 8 + j.length + (B.length ? 8 + B.length : 0);
	const head = Buffer.alloc(12);
	head.writeUInt32LE(0x46546c67, 0);
	head.writeUInt32LE(2, 4);
	head.writeUInt32LE(total, 8);
	const jh = Buffer.alloc(8);
	jh.writeUInt32LE(j.length, 0);
	jh.writeUInt32LE(0x4e4f534a, 4);
	const parts = [head, jh, j];
	if (B.length) {
		const bh = Buffer.alloc(8);
		bh.writeUInt32LE(B.length, 0);
		bh.writeUInt32LE(0x004e4942, 4);
		parts.push(bh, B);
	}
	return Buffer.concat(parts);
}
