// node tools/interactive-kit/try.mjs Name [outDir] — build one rig into a scratch dir (no pack write)
import { RIGS } from './rigs.mjs';
const [name, dir = '/tmp'] = process.argv.slice(2);
console.log(JSON.stringify(await RIGS[name](`${dir}/${name}.glb`)));
