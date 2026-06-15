import { GraphPatch } from '@repo/code-graph-core';

type ServerMessage =
  | { kind: 'snapshot-ready'; nodeCount: number; edgeCount: number }
  | { kind: 'patch'; patch: unknown };

export type WsHandlers = {
  onPatch: (patch: GraphPatch) => void;
};

export const connectWs = (handlers: WsHandlers): (() => void) => {
  const url = `ws://${window.location.host}/ws`;
  const socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    console.log('[code-graph] WS connected:', url);
  });
  socket.addEventListener('close', () => {
    console.log('[code-graph] WS closed');
  });
  socket.addEventListener('error', () => {
    console.warn('[code-graph] WS error');
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data as string) as ServerMessage;
    if (message.kind === 'patch') {
      const parsed = GraphPatch.safeParse(message.patch);
      if (parsed.success) {
        console.log(
          '[code-graph] live patch:',
          `+${parsed.data.upsertNodes.length}n/${parsed.data.upsertEdges.length}e`,
          `-${parsed.data.removeNodeIds.length}n/${parsed.data.removeEdgeIds.length}e`,
        );
        handlers.onPatch(parsed.data);
      } else {
        console.warn('[code-graph] dropped invalid patch', parsed.error.issues);
      }
    }
  });

  return () => socket.close();
};
