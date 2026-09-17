import crypto from 'node:crypto';
import {
  hasTools,
  prepareMessagesForTools,
  messageContentToString,
} from './tool_calling.js';

const ROLE_LABELS = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool',
};

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function generateId() {
  return 'chatcmpl-' + crypto.randomUUID().replace(/-/g, '');
}

export function estimateTokens(text) {
  if (!text) return 1;
  return Math.max(1, Math.floor(text.length / 4));
}

/**
 * Flatten chat history into a single prompt DeepSeek can answer.
 *
 * @param {Array<object>} messages
 * @param {Array<object>} [tools]
 * @returns {string}
 */
export function messagesToPrompt(messages, tools = null) {
  const prepared = prepareMessagesForTools(messages, tools);

  if (prepared.length === 1 && prepared[0].role === 'user') {
    return messageContentToString(prepared[0].content);
  }

  const lines = [];
  for (const m of prepared) {
    const label = ROLE_LABELS[m.role] || (m.role ? m.role.charAt(0).toUpperCase() + m.role.slice(1) : 'User');
    lines.push(`${label}: ${messageContentToString(m.content)}`);
  }
  lines.push('Assistant:');
  return lines.join('\n\n');
}

/**
 * Build standard non-streaming OpenAI chat.completion response.
 */
export function completionResponse({
  model,
  content = '',
  toolCalls = null,
  prompt = '',
  conversationId = null,
}) {
  const pt = estimateTokens(prompt);
  const ct = estimateTokens(content || (toolCalls ? JSON.stringify(toolCalls) : ''));

  const message = {
    role: 'assistant',
    content: toolCalls ? null : content,
  };

  if (toolCalls && toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  const res = {
    id: generateId(),
    object: 'chat.completion',
    created: nowSeconds(),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: toolCalls ? 'tool_calls' : 'stop',
      },
    ],
    usage: {
      prompt_tokens: pt,
      completion_tokens: ct,
      total_tokens: pt + ct,
    },
  };

  if (conversationId) {
    res.conversation_id = conversationId;
  }

  return res;
}

/**
 * Generate OpenAI-compatible SSE chunks for streaming responses.
 *
 * @param {string} model
 * @param {AsyncIterable<string>} stream
 * @yields {string}
 */
export async function* streamChunks(model, stream) {
  const cid = generateId();
  const created = nowSeconds();

  function frame(delta, finishReason = null, extra = null) {
    const obj = {
      id: cid,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    if (extra) {
      Object.assign(obj, extra);
    }
    return `data: ${JSON.stringify(obj)}\n\n`;
  }

  // First frame: announce assistant role
  yield frame({ role: 'assistant', content: '' });

  for await (const delta of stream) {
    if (delta) {
      yield frame({ content: delta });
    }
  }

  yield frame({}, 'stop');
  yield 'data: [DONE]\n\n';
}
