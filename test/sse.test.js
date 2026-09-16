import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSseLines, parseSseStream } from '../src/sse.js';

test('SSE parser: parses snapshot and append frames with message_id', async () => {
  const lines = [
    'data: {"v":{"response":{"fragments":[{"type":"RESPONSE","content":"Hello"}],"message_id":123456}}}',
    'data: {"p":"response/fragments/-1/content","o":"APPEND","v":" world"}',
    'data: {"v":"!"}',
    'data: [DONE]',
  ];

  const meta = {};
  const chunks = Array.from(parseSseLines(lines, meta));
  assert.deepEqual(chunks, ['Hello', ' world', '!']);
  assert.equal(meta.message_id, 123456);
});

test('SSE parser: stream async generator handles fragmented text chunks', async () => {
  async function* mockNetworkStream() {
    yield Buffer.from('data: {"v":{"response":{"fragments":[{"type":"RESPONSE","content":"Hi"}]}}}\n');
    yield Buffer.from('data: {"p":"response/fragments/-1/content","o":"APPEND","v":" there');
    yield Buffer.from('!"}\ndata: [DONE]\n');
  }

  const meta = {};
  const chunks = [];
  for await (const chunk of parseSseStream(mockNetworkStream(), meta)) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, ['Hi', ' there!']);
});
