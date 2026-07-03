/**
 * Standalone WebSocket relay for hosted collaboration (Phase 3).
 * Deploy to Fly.io, Render, Railway, etc.
 *
 *   PORT=8080 node relay/standalone-relay.mjs
 *
 * Set GC_PUBLIC_WS in extension/lib/gc-config.js to wss://your-host/ws
 */
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { setupRelay } from './setup-relay.mjs';

const PORT = Number(process.env.PORT) || 8080;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Gesture Canvas relay — connect via WebSocket at /ws\n');
});

const wss = new WebSocketServer({ server, path: '/ws' });
setupRelay(wss);

server.listen(PORT, () => {
  console.log(`Gesture Canvas relay listening on port ${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws`);
});
