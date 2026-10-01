import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createIndexerApp } from './app.js';

// One tiny fixture repo and one server for the whole file: indexing is the slow part.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-app-'));
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
fs.writeFileSync(
  path.join(root, 'tsconfig.json'),
  JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }),
);
fs.mkdirSync(path.join(root, 'src'));
fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const a = 1;\n');

process.env.MAX_WS_CLIENTS = '1';
const handle = createIndexerApp({ root });
await handle.indexOnBoot();
const server: Server = createServer(handle.app);
handle.attachWs(server);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `127.0.0.1:${(server.address() as AddressInfo).port}`;

// Every socket a test opens, so a failing assertion can't leave one holding the
// process open.
const sockets: WebSocket[] = [];

after(() => {
  for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) socket.terminate();
  server.closeAllConnections();
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const connect = (headers: Record<string, string> = {}): Promise<{ socket: WebSocket } | { status: number }> =>
  new Promise((resolve) => {
    const socket = new WebSocket(`ws://${base}/ws`, { headers });
    sockets.push(socket);
    socket.on('error', () => {}); // refused handshakes also emit 'error'
    socket.once('open', () => resolve({ socket }));
    socket.once('unexpected-response', (_req, res) => resolve({ status: res.statusCode ?? 0 }));
  });

test('reindex works locally but is refused in the hosted demo', async () => {
  const local = await fetch(`http://${base}/api/reindex`, { method: 'POST' });
  assert.equal(local.status, 200);

  process.env.WEB_DIST = '/nonexistent';
  try {
    const hosted = await fetch(`http://${base}/api/reindex`, { method: 'POST' });
    assert.equal(hosted.status, 403);
  } finally {
    delete process.env.WEB_DIST;
  }
});

test('the live socket refuses a foreign origin', async () => {
  const result = await connect({ Origin: 'https://evil.example' });
  assert.deepEqual(result, { status: 403 });
});

test('the live socket refuses connections past the cap', async () => {
  const first = await connect();
  assert.ok('socket' in first);
  const second = await connect();
  assert.deepEqual(second, { status: 503 });
  first.socket.terminate();
});
