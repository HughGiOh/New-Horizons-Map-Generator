// POST /api/save  → save current map as a new version (editor or admin password)
// body: { state, labels, editor (name), note, password }
import { json, authLevel, pwFrom, readJson, commitVersion } from './_common.js';
export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad json' }, 400);
  const level = await authLevel(env, pwFrom(request, body));
  if (!level) return json({ error: 'wrong password' }, 401);
  const meta = await commitVersion(env, body);
  return json({ ok: true, ...meta });
}
