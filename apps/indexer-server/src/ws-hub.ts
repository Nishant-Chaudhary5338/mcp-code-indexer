import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import type { GraphPatch } from '@repo/code-graph-core';
import type { SessionRegistry } from './session-registry.js';

type ServerMessage =
  | { kind: 'snapshot-ready'; nodeCount: number; edgeCount: number }
  | { kind: 'patch'; patch: GraphPatch }
  | { kind: 'repo-unavailable'; repoId: string | null };

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

/** Read the `?repo=` id off the WS upgrade URL, or null when absent. */
const parseRepoId = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url, 'http://localhost').searchParams.get('repo');
  } catch {
    return null;
  }
};

export interface WsHub {
  close(): void;
}

/**
 * Live-graph WebSocket hub, multi-repo aware. Each socket picks its repo via
 * `?repo=<id>` (defaulting to the registry's default repo), receives that repo's
 * full snapshot on connect, then subscribes only to that repo's patches. Repos
 * that aren't ready get a `repo-unavailable` message so the client can poll
 * `/api/repos/:id` and reconnect once it's built.
 */
export const attachWsHub = (
  server: Server,
  registry: SessionRegistry,
  path = '/ws',
): WsHub => {
  const wss = new WebSocketServer({ server, path });

  wss.on('connection', (socket: TrackedSocket, req: IncomingMessage) => {
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });
    // An unhandled 'error' on a socket crashes the process — always handle it.
    socket.on('error', () => socket.terminate());

    const repoId = parseRepoId(req.url) ?? registry.defaultId();
    const graph = repoId ? registry.resolveGraph(repoId) : null;

    if (!graph) {
      sendRaw(
        socket,
        JSON.stringify({ kind: 'repo-unavailable', repoId } satisfies ServerMessage),
      );
      // 1013 = "try again later"; close so the client reconnects once the repo is
      // ready rather than holding an idle socket open indefinitely.
      socket.close(1013, 'repo-unavailable');
      return;
    }

    // Bring this socket up to date: full current graph as an upsert patch.
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

    // Per-socket subscription: only this repo's live patches reach this client.
    const unsubscribe = graph.onPatch((patch) => {
      sendRaw(socket, JSON.stringify({ kind: 'patch', patch } satisfies ServerMessage));
    });
    socket.on('close', () => {
      socket.isAlive = false;
      unsubscribe();
    });
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

  wss.on('close', () => clearInterval(heartbeat));

  return {
    close: () => {
      clearInterval(heartbeat);
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
