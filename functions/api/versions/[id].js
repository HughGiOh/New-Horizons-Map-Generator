// GET /api/versions/:id  → the full snapshot for one version
import { json } from '../_common.js';
export async function onRequestGet({ env, params }) {
  const v = await env.MAP.get('version:' + params.id, 'json');
  if (!v) return json({ error: 'not found' }, 404);
  return json({ version: v });
}
