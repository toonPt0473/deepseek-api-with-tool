import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

test('Server: /healthz returns ok', async () => {
  const app = createServer({ client: {} });
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { status: 'ok' });
  } finally {
    server.close();
  }
});

test('Server: /v1/models returns model list', async () => {
  const app = createServer({ client: {} });
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.object, 'list');
    const ids = body.data.map((m) => m.id);
    assert.ok(ids.includes('deepseek-chat'));
    assert.ok(ids.includes('deepseek-expert'));
  } finally {
    server.close();
  }
});

test('Server: /v1/chat/completions rejects empty messages and invalid model', async () => {
  const app = createServer({ client: {} });
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // Empty messages
    const res1 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });
    assert.equal(res1.status, 400);

    // Invalid model
    const res2 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'unknown-model-xyz',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    assert.equal(res2.status, 404);
  } finally {
    server.close();
  }
});

test('Server: /v1/chat/completions emulates tool calling correctly', async () => {
  const mockClient = {
    ensureSession: async () => {},
    chat: async (prompt) => {
      return {
        text: '```json\n{\n  "tool_calls": [\n    {\n      "name": "lookup_user",\n      "arguments": { "id": 42 }\n    }\n  ]\n}\n```',
        conversation_id: 'mock_session:100',
      };
    },
  };

  const app = createServer({ client: mockClient });
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Find user 42' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'lookup_user',
              parameters: {
                type: 'object',
                properties: { id: { type: 'number' } },
              },
            },
          },
        ],
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.choices[0].finish_reason, 'tool_calls');
    assert.equal(data.choices[0].message.content, null);
    assert.ok(data.choices[0].message.tool_calls.length > 0);
    assert.equal(data.choices[0].message.tool_calls[0].function.name, 'lookup_user');
    assert.equal(JSON.parse(data.choices[0].message.tool_calls[0].function.arguments).id, 42);
  } finally {
    server.close();
  }
});
