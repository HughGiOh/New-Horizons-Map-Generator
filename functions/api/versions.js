// GET /api/versions  → list of version metadata (newest first)
import { json } from './_common.js';
export async function onRequestGet({ env }) {
  const index = (await env.MAP.get('index', 'json')) || [];
  return json({ versions: index });
}
