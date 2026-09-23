// Credits per call — docs.meshy.ai/api/pricing, read 2026-09-23. The ledger reserves
// THIS number before the POST and then corrects it to the task's own
// `consumed_credits` once the task ends (FAILED tasks report 0: Meshy refunds them).

/** @param {{stage: string, model?: string, geometryResolution?: string, textureResolution?: string, actions?: number}} p */
export function priceOf({ stage, model = 't2', geometryResolution = 'standard', textureResolution = '2k', actions = 1 }) {
	switch (stage) {
		case 'preview': {
			if (model === 't2' || model === 'meshy-t2' || model === 'meshy-6-lite') return 5;
			const ultra = geometryResolution === '2k' || geometryResolution === '4k';
			if (model === 'meshy-7.1' || model === 'meshy-7' || model === 'latest') return 20 + (ultra ? 5 : 0);
			return 20; // meshy-6 and anything unknown: assume the dear price
		}
		case 'refine':
		case 'retexture':
			return textureResolution === '8k' ? 15 : 10;
		case 'remesh':
			return 5;
		// 30c-game-assets: auto-rigging (a humanoid, textured mesh) ships its walking + running
		// clips for the one price; an animation task is 3 per library action in it
		case 'rig':
			return 5;
		case 'animate':
			return 3 * Math.max(1, Math.min(10, Math.floor(actions) || 1));
		default:
			throw new Error(`no price for stage "${stage}"`);
	}
}

export const PRICE_TABLE = {
	'preview t2 (smart-topology, target 100-15k tris)': 5,
	'preview meshy-6-lite': 5,
	'preview meshy-6': 20,
	'preview meshy-7.1 / latest (standard geometry)': 20,
	'preview meshy-7.1 geometry 2k/4k': 25,
	'refine 2k/4k texture': 10,
	'refine 8k texture': 15,
	'retexture 2k/4k': 10,
	'retexture 8k': 15,
	remesh: 5,
	'rig (auto-rigging; walking + running clips included)': 5,
	'animate (per library action, 1-10 per task)': 3,
	'image-to-3d t2 untextured / textured': '5 / 15',
	'image-to-3d meshy-6/7 untextured / textured': '20 / 30'
};
