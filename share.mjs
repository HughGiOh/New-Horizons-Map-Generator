// share.mjs — serve the app and open a temporary public Cloudflare tunnel.
// One command:  npm run share   →  prints a https://*.trycloudflare.com link to share.
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const CF = join(__dirname, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');

if (!existsSync(CF)) {
  console.error('\n  cloudflared not found. Download it next to this file:');
  console.error('  https://github.com/cloudflare/cloudflared/releases/latest\n');
  process.exit(1);
}

console.log(`Starting static server on :${PORT} …`);
const server = spawn(process.execPath, [join(__dirname, 'server.mjs')], { env: { ...process.env, PORT }, stdio: 'inherit' });

const tunnel = spawn(CF, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
const onData = d => {
  const s = d.toString();
  const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m) {
    console.log('\n  ┌──────────────────────────────────────────────────────────────┐');
    console.log('  │  Public link (live while this window stays open):              │');
    console.log('  │  ' + m[0].padEnd(60) + '│');
    console.log('  └──────────────────────────────────────────────────────────────┘\n');
  }
};
tunnel.stdout.on('data', onData);
tunnel.stderr.on('data', onData);

const stop = () => { server.kill(); tunnel.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
