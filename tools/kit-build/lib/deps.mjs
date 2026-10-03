// The one dependency set every pack tool uses: tools/meshy's node_modules (`cd tools/meshy && npm ci`).
// MESHY_TOOLS overrides the folder (a lane that keeps its tools checkout elsewhere).
//
// ONE MODULE INSTANCE: gltf-transform checks `instanceof` (prune, flatten, …), so a Document must be
// read and transformed through the SAME build of it. Every pack tool (kit-build, tools/lod, the kit
// builds) loads the CommonJS build through `load` here; meshy-post (tools/meshy/lib/post.js) uses the
// ES build internally and is only ever handed FILE paths.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../..');
export const TOOLS = process.env.MESHY_TOOLS || path.join(REPO, 'tools/meshy');
const req = createRequire(path.join(TOOLS, 'package.json'));
/** a package from tools/meshy's node_modules @param {string} id @returns {Promise<any>} */
export const load = async (id) => import(pathToFileURL(req.resolve(id)).href);
/** import a file of tools/meshy (lib/post.js, lib/thumb.js) @param {string} rel */
export const tool = async (rel) => import(pathToFileURL(path.join(TOOLS, rel)).href);

const { NodeIO, Logger } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
/** a NodeIO with every extension, quiet (stdout carries reports) */
export function makeIO() {
	return new NodeIO().registerExtensions(ALL_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR));
}
