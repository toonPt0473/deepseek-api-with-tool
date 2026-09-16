import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateTokens,
  messagesToPrompt,
  completionResponse,
  streamChunks,
} from '../src/openai_format.js';

test('OpenAI format: estimates tokens', () => {
  assert.equal(estimateTokens(''), 1);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('12345678'), 2);
});

test('OpenAI format: flattens single user message without prefix', () => {
  const prompt = messagesToPrompt([{ role: 'user', content: 'Hi there' }]);
  assert.equal(prompt, 'Hi there');
});

test('OpenAI format: flattens multi-turn conversation with labels', () => {
  const prompt = messagesToPrompt([
    { role: 'system', content: 'You are an assistant' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi! How can I help?' },
    { role: 'user', content: 'Tell me a fact' },
  ]);

  assert.ok(prompt.includes('System: You are an assistant'));
  assert.ok(prompt.includes('User: Hello'));
  assert.ok(prompt.includes('Assistant: Hi! How can I help?'));
  assert.ok(prompt.includes('User: Tell me a fact'));
  assert.ok(prompt.endsWith('Assistant:'));
});

test('OpenAI format: creates standard completionResponse', () => {
  const res = completionResponse({
    model: 'deepseek-chat',
    content: 'All good!',
    prompt: 'How are you?',
    conversationId: 'sess_123:456',
  });

  assert.equal(res.object, 'chat.completion');
  assert.equal(res.model, 'deepseek-chat');
  assert.equal(res.choices[0].message.content, 'All good!');
  assert.equal(res.choices[0].finish_reason, 'stop');
  assert.equal(res.conversation_id, 'sess_123:456');
  assert.ok(res.usage.total_tokens > 0);
});

test('OpenAI format: creates tool_calls completionResponse', () => {
  const toolCalls = [
    {
      id: 'call_abc',
      type: 'function',
      function: { name: 'get_time', arguments: '{}' },
    },
  ];

  const res = completionResponse({
    model: 'deepseek-chat',
    toolCalls,
    prompt: 'What time is it?',
  });

  assert.equal(res.choices[0].finish_reason, 'tool_calls');
  assert.equal(res.choices[0].message.content, null);
  assert.deepEqual(res.choices[0].message.tool_calls, toolCalls);
});

test('OpenAI format: streamChunks yields SSE frames ending in [DONE]', async () => {
  async function* mockStream() {
    yield 'Hello';
    yield ' world';
  }
  mockStream.conversationId = 'cid_999';

  const chunks = [];
  for await (const frame of streamChunks('deepseek-chat', mockStream())) {
    chunks.push(frame);
  }

  assert.ok(chunks.length >= 4);
  assert.ok(chunks[0].includes('"role":"assistant"'));
  assert.ok(chunks[chunks.length - 1].includes('[DONE]'));
});
