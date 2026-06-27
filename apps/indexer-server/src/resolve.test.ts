import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { resolveGraphOr, type GraphResolver, type RepoResolution } from './routes/resolve.js';
import type { GraphService } from './graph-service.js';

// ---------------------------------------------------------------------------
// Minimal stand-ins — only the surface that resolveGraphOr exercises.
// ---------------------------------------------------------------------------

const fakeReq = (): Request => ({}) as Request;

interface FakeRes {
  writtenStatus: number | null;
  writtenBody: unknown;
  status(code: number): FakeRes;
  json(body: unknown): void;
}

const fakeRes = (): FakeRes => {
  const r: FakeRes = {
    writtenStatus: null,
    writtenBody: undefined,
    status(code) {
      r.writtenStatus = code;
      return r;
    },
    json(body) {
      r.writtenBody = body;
    },
  };
  return r;
};

// A minimal GraphService stand-in — resolveGraphOr only passes it through.
const stubGraph = { label: 'stub' } as unknown as GraphService;

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('resolveGraphOr returns the GraphService when resolver says ok', () => {
  const resolver: GraphResolver = () => ({ ok: true, graph: stubGraph });
  const res = fakeRes();
  const result = resolveGraphOr(resolver, fakeReq(), res as unknown as Response);
  assert.equal(result, stubGraph);
  assert.equal(res.writtenStatus, null, 'should not write a status on success');
  assert.equal(res.writtenBody, undefined, 'should not write a body on success');
});

// ---------------------------------------------------------------------------
// 404 — repo not found
// ---------------------------------------------------------------------------

test('resolveGraphOr writes status 404 and returns null when resolver returns 404', () => {
  const resolver: GraphResolver = (): RepoResolution => ({
    ok: false,
    status: 404,
    error: 'Repository not found',
  });
  const res = fakeRes();
  const result = resolveGraphOr(resolver, fakeReq(), res as unknown as Response);
  assert.equal(result, null);
  assert.equal(res.writtenStatus, 404);
  assert.deepEqual(res.writtenBody, { error: 'Repository not found' });
});

// ---------------------------------------------------------------------------
// 503 — repo not ready yet
// ---------------------------------------------------------------------------

test('resolveGraphOr writes status 503 and returns null when resolver returns 503', () => {
  const resolver: GraphResolver = (): RepoResolution => ({
    ok: false,
    status: 503,
    error: 'Repository is still indexing',
  });
  const res = fakeRes();
  const result = resolveGraphOr(resolver, fakeReq(), res as unknown as Response);
  assert.equal(result, null);
  assert.equal(res.writtenStatus, 503);
  assert.deepEqual(res.writtenBody, { error: 'Repository is still indexing' });
});

// ---------------------------------------------------------------------------
// Error body always uses the resolver's error string verbatim
// ---------------------------------------------------------------------------

test('resolveGraphOr forwards the exact error string in the json body', () => {
  const errorMsg = 'Custom error: something went wrong';
  const resolver: GraphResolver = (): RepoResolution => ({
    ok: false,
    status: 404,
    error: errorMsg,
  });
  const res = fakeRes();
  resolveGraphOr(resolver, fakeReq(), res as unknown as Response);
  const body = res.writtenBody as { error: string };
  assert.equal(body.error, errorMsg);
});

// ---------------------------------------------------------------------------
// Resolver receives the original request unchanged
// ---------------------------------------------------------------------------

test('resolveGraphOr passes the original Request object to the resolver', () => {
  const req = fakeReq();
  let receivedReq: Request | null = null;
  const resolver: GraphResolver = (r) => {
    receivedReq = r;
    return { ok: true, graph: stubGraph };
  };
  resolveGraphOr(resolver, req, fakeRes() as unknown as Response);
  assert.equal(receivedReq, req);
});
