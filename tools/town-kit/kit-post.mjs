// kit-post: the town kit's post step now lives in tools/kit-build/lib/post.mjs — roadmap 34 E2, one
// pack build tool instead of four forks. This file stays so build.mjs and the tests keep their import.
import { kitPost as post } from '../kit-build/lib/post.mjs';

export { TOOLS, parseClamp, seamClamp, glowMask, recolor, hsv } from '../kit-build/lib/post.mjs';

/** town-kit runs the z-fight pass itself, with a judge (build.mjs) — so not here
 * @param {string} input @param {string} output @param {any} job */
export const kitPost = (input, output, job) => post(input, output, { defight: false, ...job });
