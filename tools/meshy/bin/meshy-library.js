#!/usr/bin/env node
// meshy-library [--search walk] [--category WalkAndRun|BodyMovements|DailyActions|Fighting|Dancing] [--ids 1,2]
//   The animation library (GET, FREE — no credits): the action ids an `animate` job takes.
import { parseArgs, die } from '../lib/cli.js';
import { get } from '../lib/api.js';

const a = parseArgs(process.argv.slice(2));
if (!process.env.MESHY_API_KEY) die('MESHY_API_KEY is not set — run: set -a; . ~/.config/theprototype/meshy.env; set +a');
const q = new URLSearchParams();
if (a.search) q.set('search', String(a.search));
if (a.category) q.set('category', String(a.category));
if (a['sub-category']) q.set('sub_category', String(a['sub-category']));
if (a.ids) q.set('action_ids', String(a.ids));
const body = /** @type {any} */ (await get(`/openapi/v1/animations/library${q.size ? '?' + q : ''}`));
const rows = Array.isArray(body) ? body : (body?.result ?? body?.data ?? body?.items ?? []);
if (a.json || !Array.isArray(rows) || !rows.length) console.log(JSON.stringify(body, null, 2));
else for (const r of rows) console.log([r.action_id ?? r.id, r.name ?? r.key, r.category, r.sub_category].filter((v) => v != null).join('\t'));
