/**
 * HTTPS dev server + WebSocket gesture relay
 * https://localhost:3000
 */

import { createServer } from 'node:https';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocketServer } from 'ws';
import { setupRelay } from '../relay/setup-relay.mjs';

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT) || 3000;
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CERT_DIR = join(ROOT, 'server', '.cert');

const MKCERT_KEY = join(CERT_DIR, 'localhost+2-key.pem');
const MKCERT_CERT = join(CERT_DIR, 'localhost+2.pem');
const OPENSSL_KEY = join(CERT_DIR, 'localhost-key.pem');
const OPENSSL_CERT = join(CERT_DIR, 'localhost.pem');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const BLOCKED_PREFIXES = [join(ROOT, 'server', '.cert'), join(ROOT, '.env')];

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureCert() {
  await mkdir(CERT_DIR, { recursive: true });

  if ((await fileExists(MKCERT_KEY)) && (await fileExists(MKCERT_CERT))) {
    return { keyPath: MKCERT_KEY, certPath: MKCERT_CERT, trusted: true };
  }

  if ((await fileExists(OPENSSL_KEY)) && (await fileExists(OPENSSL_CERT))) {
    return { keyPath: OPENSSL_KEY, certPath: OPENSSL_CERT, trusted: false };
  }

  if (await fileExists(join(process.env.HOME || '', '.local', 'share', 'mkcert', 'rootCA.pem'))) {
    try {
      await execFileAsync('mkcert', ['-cert-file', MKCERT_CERT, '-key-file', MKCERT_KEY, 'localhost', '127.0.0.1', '::1'], {
        cwd: CERT_DIR,
      });
      return { keyPath: MKCERT_KEY, certPath: MKCERT_CERT, trusted: true };
    } catch {
      /* fall through */
    }
  }

  await execFileAsync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-keyout', OPENSSL_KEY, '-out', OPENSSL_CERT,
    '-days', '825', '-nodes', '-subj', '/CN=localhost',
  ]);

  return { keyPath: OPENSSL_KEY, certPath: OPENSSL_CERT, trusted: false };
}

function isBlocked(filePath) {
  const resolved = resolve(filePath);
  return BLOCKED_PREFIXES.some((p) => resolved.startsWith(p + sep) || resolved === p);
}

async function serveStatic(pathname) {
  let rel = pathname;
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/companion' || rel === '/companion/') rel = '/companion/index.html';
  if (rel === '/relay-client.html' || rel.startsWith('/relay-client.html')) rel = '/relay-client.html';
  if (rel.includes('..')) return null;

  const filePath = resolve(ROOT, '.' + rel);
  if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) return null;
  if (isBlocked(filePath)) return null;

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return null;
    const body = await readFile(filePath);
    return { body, type: MIME[extname(filePath)] || 'application/octet-stream' };
  } catch {
    return null;
  }
}

async function main() {
  const { keyPath, certPath, trusted } = await ensureCert();
  const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)]);

  const server = createServer({ key, cert }, (req, res) => {
    (async () => {
      const url = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);
      const file = await serveStatic(url.pathname);

      if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': file.type,
        'Cache-Control': 'no-cache',
      });
      res.end(file.body);
    })().catch((err) => {
      console.error(err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Server error');
      }
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  setupRelay(wss);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${PORT} is already in use.\n`);
    } else {
      console.error(err.message || err);
    }
    process.exit(1);
  });

  server.listen({ port: PORT, host: '::', ipv6Only: false }, () => {
    console.log('');
    console.log('  Gesture Canvas — HTTPS + gesture relay');
    console.log('  ───────────────────────────────────────');
    console.log(`  App:        https://localhost:${PORT}`);
    console.log(`  Phone:      https://localhost:${PORT}/companion/`);
    console.log(`  WebSocket:  wss://localhost:${PORT}/ws`);
    console.log('');
    console.log('  Load extension: chrome://extensions → Load unpacked → extension/');
    console.log('');
    if (trusted) {
      console.log('  mkcert certificate active.');
    } else {
      console.log('  Self-signed cert — proceed in browser if prompted.');
    }
    console.log('');
  });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
