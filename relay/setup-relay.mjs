/**
 * WebSocket gesture relay — shared by dev server and standalone deploy.
 */

const PARTICIPANT_COLORS = [
  '#facc15',
  '#38bdf8',
  '#f472b6',
  '#4ade80',
  '#fb923c',
  '#a78bfa',
];

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * @param {import('ws').WebSocketServer} wss
 */
export function setupRelay(wss) {
  /** @type {Map<string, { extension: import('ws').WebSocket | null, companions: Set<import('ws').WebSocket> }>} */
  const rooms = new Map();

  function getRoom(sessionId) {
    if (!rooms.has(sessionId)) {
      rooms.set(sessionId, { extension: null, companions: new Set() });
    }
    return rooms.get(sessionId);
  }

  function assignParticipant(ws, room) {
    const index = room.companions.size % PARTICIPANT_COLORS.length;
    ws.participantId = randomId();
    ws.participantColor = PARTICIPANT_COLORS[index];
    return { participantId: ws.participantId, color: ws.participantColor };
  }

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === 'join') {
        ws.sessionId = msg.sessionId;
        ws.role = msg.role;
        const room = getRoom(msg.sessionId);

        if (msg.role === 'extension') {
          room.extension = ws;
          ws.send(JSON.stringify({ type: 'joined', sessionId: msg.sessionId, role: 'extension' }));
        } else {
          room.companions.add(ws);
          const { participantId, color } = assignParticipant(ws, room);
          ws.send(JSON.stringify({
            type: 'joined',
            sessionId: msg.sessionId,
            role: 'companion',
            participantId,
            color,
          }));
        }
        return;
      }

      const sessionId = msg.sessionId || ws.sessionId;
      if (!sessionId) return;
      const room = rooms.get(sessionId);
      if (!room) return;

      const outbound = { ...msg };
      if (ws.participantId) {
        outbound.participantId = ws.participantId;
        outbound.participantColor = ws.participantColor;
      }

      if (ws.role === 'companion' && room.extension?.readyState === 1) {
        room.extension.send(JSON.stringify(outbound));
      }
    });

    ws.on('close', () => {
      if (!ws.sessionId) return;
      const room = rooms.get(ws.sessionId);
      if (!room) return;
      if (ws.role === 'extension' && room.extension === ws) room.extension = null;
      else room.companions.delete(ws);
    });
  });
}
