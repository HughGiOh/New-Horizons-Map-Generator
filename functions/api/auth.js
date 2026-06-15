// POST /api/auth  → check a password, return its level ('admin' | 'editor')
import { json, authLevel, readJson } from './_common.js';
export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad json' }, 400);
  const level = await authLevel(env, body.password || '');
  if (!level) return json({ error: 'wrong password' }, 401);
  return json({ level });
}
