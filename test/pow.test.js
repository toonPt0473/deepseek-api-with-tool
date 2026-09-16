import test from 'node:test';
import assert from 'node:assert/strict';
import { DeepSeekPow } from '../src/pow.js';

test('DeepSeekPow: initializes and solves challenge correctly', () => {
  const pow = new DeepSeekPow();
  assert.ok(pow);

  // Use the wasm module's internal hash function to generate a valid target challenge
  const prefix = 'test_salt_123_';
  const answer = 99;

  // Compute hash of prefix + answer using the wasm module
  const retptr = pow._addToStack(-16);
  const [ptr, len] = pow._writeStr(prefix + String(answer));
  pow._instance.exports.wasm_deepseek_hash_v1(retptr, ptr, len);

  const mem = pow._instance.exports.memory.buffer;
  const view = new DataView(mem);
  const outPtr = view.getInt32(retptr, true);
  const outLen = view.getInt32(retptr + 4, true);
  pow._addToStack(16);

  const targetHash = Buffer.from(new Uint8Array(mem, outPtr, outLen)).toString('utf-8');
  assert.equal(targetHash.length, 64);

  // Now solve for targetHash
  const solvedAnswer = pow.solve(targetHash, prefix, 1000);
  assert.equal(solvedAnswer, answer);

  // Test makeHeader
  const challengeObj = {
    algorithm: 'DeepSeekHashV1',
    challenge: targetHash,
    salt: 'test_salt',
    expire_at: 123,
    difficulty: 1000,
    signature: 'sig_12345',
    target_path: '/api/v0/chat/completion',
  };

  const header = pow.makeHeader(challengeObj);
  assert.ok(typeof header === 'string');
  const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
  assert.equal(decoded.answer, 99);
  assert.equal(decoded.algorithm, 'DeepSeekHashV1');
  assert.equal(decoded.salt, 'test_salt');
});
