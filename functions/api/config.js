// GET  /api/config  → { usingDefaults }  (warn admins to change default passwords)
// POST /api/config  → change admin/editor passwords (requires CURRENT admin password)
//   body: { password (current admin), newAdmin?, newEditor? }
import { json, authLevel, pwFrom, readJson, getConfig, hash, salt } from './_common.js';

export async function onRequestGet({ env }) {
  const c = await getConfig(env);
  return json({ usingDefaults: !!c.usingDefaults });
}

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad json' }, 400);
  const level = await authLevel(env, pwFrom(request, body));
  if (level !== 'admin') return json({ error: 'admin password required' }, 401);

  const c = await getConfig(env);
  const next = { ...c, usingDefaults: false };
  if (body.newAdmin) { const s = salt(); next.adminSalt = s; next.adminHash = await hash(s, body.newAdmin); }
  if (body.newEditor) { const s = salt(); next.editorSalt = s; next.editorHash = await hash(s, body.newEditor); }
  await env.MAP.put('config', JSON.stringify(next));
  return json({ ok: true });
}
