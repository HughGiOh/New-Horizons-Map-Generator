// POST /api/restore  → make an old version the new latest (creates a new version)
// body: { version, editor (name), password }
import { json, authLevel, pwFrom, readJson, commitVersion } from './_common.js';
export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad json' }, 400);
  const level = await authLevel(env, pwFrom(request, body));
  if (!level) return json({ error: 'wrong password' }, 401);
  const src = await env.MAP.get('version:' + body.version, 'json');
  if (!src) return json({ error: 'not found' }, 404);
  const meta = await commitVersion(env, {
    state: src.state, labels: src.labels, editor: body.editor,
    note: 'restored v' + body.version,
  });
  return json({ ok: true, ...meta });
}
