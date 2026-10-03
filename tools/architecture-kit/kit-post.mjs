// kit-post: the architecture kit's post step now lives in tools/kit-build/lib/post.mjs — roadmap 34
// E2, one pack build tool instead of four forks. This file stays so build.mjs and the tests keep
// their import. CLI: node tools/kit-build/kit-build.mjs post <raw.glb> <out.glb> '<job json>'
export { TOOLS, kitPost, parseClamp, seamClamp } from '../kit-build/lib/post.mjs';
