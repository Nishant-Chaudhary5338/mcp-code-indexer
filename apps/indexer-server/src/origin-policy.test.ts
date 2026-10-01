import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin } from './origin-policy.js';

test('requests without an Origin (tools, curl) are allowed', () => {
  assert.equal(isAllowedOrigin(undefined, { hosted: true }), true);
});

test('the page this server served is allowed when its host matches', () => {
  assert.equal(
    isAllowedOrigin('https://demo.example', { hosted: true, host: 'demo.example' }),
    true,
  );
});

test('a foreign origin is refused', () => {
  assert.equal(
    isAllowedOrigin('https://evil.example', { hosted: true, host: 'demo.example' }),
    false,
  );
});

test('localhost dev ports are trusted locally but not on a public deploy', () => {
  assert.equal(isAllowedOrigin('http://localhost:5182', { hosted: false }), true);
  assert.equal(isAllowedOrigin('http://localhost:5182', { hosted: true, host: 'demo.example' }), false);
});

test('a malformed Origin is refused rather than throwing', () => {
  assert.equal(isAllowedOrigin('not a url', { hosted: true, host: 'demo.example' }), false);
});
