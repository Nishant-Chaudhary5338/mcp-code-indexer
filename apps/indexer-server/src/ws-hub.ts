import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { GraphPatch } from '@repo/code-graph-core';
import type { GraphService } from './graph-service.js';

type ServerMessage =
  | { kind: 'snapshot-ready'; nodeCount: number; edgeCount: number }
  | { kind: 'patch'; patch: GraphPatch };

/** Heartbeat cadence; sockets that miss a round-trip are terminated. */
const HEARTBEAT_MS = 30_000;
/**
 * If a client's send buffer grows past this, it can't keep up — drop it rather
 * than let memory balloon (slow-consumer backpressure).
 */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

interface TrackedSocket extends WebSocket {
  isAlive?: boolean;
}

/** Send a pre-serialized payload, honoring backpressure. */
const sendRaw = (socket: TrackedSocket, payload: string): void => {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    // Slow consumer: terminate instead of buffering unbounded.
    socket.terminate();
    return;
  }
  socket.send(payload);
};

export interface WsHub {
  close(): void;
}

export const attachWsHub = (
  server: Server,
  graph: GraphService,
  // Path the WS endpoint listens on. Defaults to '/ws' for standalone use; a
  // host app can mount it elsewhere (e.g. '/indexer/ws').
  path = '/ws',
): WsHub => {
  const wss = new WebSocketServer({ server, path });

  wss.on('connection', (socket: TrackedSocket) => {
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });
    // An unhandled 'error' on a socket crashes the process — always handle it.
    socket.on('error', () => {
      socket.terminate();
    });
    socket.on('close', () => {
      socket.isAlive = false;
    });

    // Bring late joiners up to date: send the full current graph as an upsert
    // patch so they aren't stuck on a stale/empty view until the next change.
    const snapshot = graph.getSnapshot();
    if (snapshot) {
      sendRaw(
        socket,
        JSON.stringify({
          kind: 'snapshot-ready',
          nodeCount: snapshot.meta.nodeCount,
          edgeCount: snapshot.meta.edgeCount,
        } satisfies ServerMessage),
      );
      sendRaw(
        socket,
        JSON.stringify({
          kind: 'patch',
          patch: {
            upsertNodes: snapshot.nodes,
            removeNodeIds: [],
            upsertEdges: snapshot.edges,
            removeEdgeIds: [],
            meta: snapshot.meta,
          },
        } satisfies ServerMessage),
      );
    }
  });

  // Heartbeat: terminate sockets that didn't pong since the last sweep.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const socket = client as TrackedSocket;
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }
  }, HEARTBEAT_MS);
  // Don't keep the event loop alive solely for the heartbeat.
  heartbeat.unref?.();

  const unsubscribe = graph.onPatch((patch) => {
    // Serialize the payload ONCE per broadcast, not once per client.
    const payload = JSON.stringify({ kind: 'patch', patch } satisfies ServerMessage);
    for (const client of wss.clients) {
      sendRaw(client as TrackedSocket, payload);
    }
  });

  wss.on('close', () => clearInterval(heartbeat));

  return {
    close: () => {
      clearInterval(heartbeat);
      unsubscribe();
      for (const client of wss.clients) {
        try {
          client.terminate();
        } catch {
          /* ignore */
        }
      }
      wss.close();
    },
  };
};
