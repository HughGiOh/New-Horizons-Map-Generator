// Shared helpers for the Pages Functions API. (Underscore prefix = not a route.)
export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const enc = new TextEncoder();
export async function hash(salt, pw) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(salt + '|' + pw));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function salt() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
}

// passwords live in KV so the admin can change them; seeded once from env vars on first use.
export async function getConfig(env) {
  let c = await env.MAP.get('config', 'json');
  if (!c) {
    const a = env.INIT_ADMIN_PASSWORD || 'admin';
    const e = env.INIT_EDITOR_PASSWORD || 'edit';
    const as = salt(), es = salt();
    c = {
      adminSalt: as, adminHash: await hash(as, a),
      editorSalt: es, editorHash: await hash(es, e),
      usingDefaults: !(env.INIT_ADMIN_PASSWORD && env.INIT_EDITOR_PASSWORD),
    };
    await env.MAP.put('config', JSON.stringify(c));
  }
  return c;
}

// returns 'admin' | 'editor' | null
export async function authLevel(env, pw) {
  if (!pw) return null;
  const c = await getConfig(env);
  if (await hash(c.adminSalt, pw) === c.adminHash) return 'admin';
  if (await hash(c.editorSalt, pw) === c.editorHash) return 'editor';
  return null;
}

export const pwFrom = (request, body) =>
  request.headers.get('x-map-password') || (body && body.password) || '';

export async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

// append a snapshot as a new version; returns its metadata
export async function commitVersion(env, { state, labels, editor, note }) {
  const index = (await env.MAP.get('index', 'json')) || [];
  const version = (index[0]?.version || 0) + 1;
  const ts = new Date().toISOString();
  const ed = (editor || '').toString().slice(0, 60) || 'unknown';
  const nt = (note || '').toString().slice(0, 200);
  const snap = { version, ts, editor: ed, note: nt, state: state || {}, labels: labels || [] };
  await env.MAP.put('version:' + version, JSON.stringify(snap));
  await env.MAP.put('latest', JSON.stringify(snap));
  index.unshift({ version, ts, editor: ed, note: nt });
  await env.MAP.put('index', JSON.stringify(index.slice(0, 500)));
  return { version, ts, editor: ed, note: nt };
}
