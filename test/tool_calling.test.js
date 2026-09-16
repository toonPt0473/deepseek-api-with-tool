import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasTools,
  buildToolInstructionPrompt,
  prepareMessagesForTools,
  parseAssistantResponse,
} from '../src/tool_calling.js';

test('Tool calling: detects tools and builds prompt instructions', () => {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get weather for a city',
        parameters: {
          type: 'object',
          properties: { location: { type: 'string' } },
          required: ['location'],
        },
      },
    },
  ];

  assert.equal(hasTools(tools), true);
  assert.equal(hasTools([]), false);

  const prompt = buildToolInstructionPrompt(tools);
  assert.ok(prompt.includes('get_weather'));
  assert.ok(prompt.includes('tool_calls'));
});

test('Tool calling: prepares messages and injects system instructions', () => {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'calculate',
        description: 'Do math',
      },
    },
  ];

  const messages = [
    { role: 'user', content: 'Calculate 2 + 2' },
  ];

  const prepared = prepareMessagesForTools(messages, tools);
  assert.equal(prepared.length, 2);
  assert.equal(prepared[0].role, 'system');
  assert.ok(prepared[0].content.includes('AVAILABLE TOOLS'));
  assert.equal(prepared[1].role, 'user');
  assert.equal(prepared[1].content, 'Calculate 2 + 2');
});

test('Tool calling: parses tool calls inside fenced JSON code block', () => {
  const rawText = '```json\n{\n  "tool_calls": [\n    {\n      "name": "get_weather",\n      "arguments": { "location": "Tokyo" }\n    }\n  ]\n}\n```';

  const result = parseAssistantResponse(rawText);
  assert.equal(result.isToolCall, true);
  assert.equal(result.content, null);
  assert.ok(Array.isArray(result.toolCalls));
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].function.name, 'get_weather');
  assert.equal(JSON.parse(result.toolCalls[0].function.arguments).location, 'Tokyo');
});

test('Tool calling: returns normal conversational text if no tool called', () => {
  const normalText = 'Hello! The weather today is sunny and pleasant.';
  const result = parseAssistantResponse(normalText);
  assert.equal(result.isToolCall, false);
  assert.equal(result.toolCalls, null);
  assert.equal(result.content, normalText);
});
