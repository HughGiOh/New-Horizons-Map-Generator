// GET /api/state  → the latest saved map (or null if nothing saved yet)
import { json } from './_common.js';
export async function onRequestGet({ env }) {
  const latest = await env.MAP.get('latest', 'json');
  return json({ latest: latest || null });
}
