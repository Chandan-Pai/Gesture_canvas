# Gesture Canvas — WebSocket relay

Forwards gesture events from companion clients to the Chrome extension.

## Local (bundled with dev server)

```bash
npm run dev
# wss://localhost:3000/ws
```

## Standalone deploy

```bash
npm run relay
# or: PORT=8080 node relay/standalone-relay.mjs
```

Deploy to Fly.io, Render, Railway, etc. Expose port and use **WSS** in production (TLS terminator in front).

After deploy, set in both:

- `extension/lib/gc-config.js` → `GC_PUBLIC_WS`
- `docs/lib/gc-config.js` → `GC_PUBLIC_WS`

## Protocol

1. **join** `{ type: 'join', role: 'extension'|'companion', sessionId }`
2. Server responds **joined** with `participantId` + `color` for companions
3. Companions send **gesture** / **mode** messages → forwarded to extension socket
