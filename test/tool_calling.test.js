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

test('Tool calling: parses native DeepSeek DSML tool calls (parallel invokes)', () => {
  const dsmlText = `
 <｜｜DSML｜｜ calls>
 <｜｜DSML｜｜ invoke name="read">
 <｜｜DSML｜｜ parameter name="i" string="true">Reading existing faker sample</｜｜DSML｜｜ parameter>
 <｜｜DSML｜｜ parameter name="path" string="true">faker-sample.json</｜｜DSML｜｜ parameter>
 </｜｜DSML｜｜ invoke>
 <｜｜DSML｜｜ invoke name="read">
 <｜｜DSML｜｜ parameter name="i" string="true">Reading thaid mock citizens</｜｜DSML｜｜ parameter>
 <｜｜DSML｜｜ parameter name="path" string="true">thaid-mock/citizens.json</｜｜DSML｜｜ parameter>
 </｜｜DSML｜｜ invoke>
 </｜｜DSML｜｜ calls>
  `;

  const result = parseAssistantResponse(dsmlText);
  assert.equal(result.isToolCall, true);
  assert.equal(result.content, null);
  assert.ok(Array.isArray(result.toolCalls));
  assert.equal(result.toolCalls.length, 2);

  assert.equal(result.toolCalls[0].function.name, 'read');
  const args0 = JSON.parse(result.toolCalls[0].function.arguments);
  assert.equal(args0.path, 'faker-sample.json');
  assert.equal(args0.i, 'Reading existing faker sample');

  assert.equal(result.toolCalls[1].function.name, 'read');
  const args1 = JSON.parse(result.toolCalls[1].function.arguments);
  assert.equal(args1.path, 'thaid-mock/citizens.json');
  assert.equal(args1.i, 'Reading thaid mock citizens');
});

test('Tool calling: parses DSML tool calls with conversational prefix', () => {
  const dsmlText = `
I will read the files now to check the structure.
<｜｜DSML｜｜ calls>
<｜｜DSML｜｜ invoke name="read">
<｜｜DSML｜｜ parameter name="path" string="true">config.json</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>
  `;

  const result = parseAssistantResponse(dsmlText);
  assert.equal(result.isToolCall, true);
  assert.equal(result.content, 'I will read the files now to check the structure.');
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].function.name, 'read');
  assert.equal(JSON.parse(result.toolCalls[0].function.arguments).path, 'config.json');
});

