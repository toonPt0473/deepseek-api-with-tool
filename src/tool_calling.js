import crypto from 'node:crypto';

/**
 * Tool Calling Emulation Layer (Shim) for DeepSeek Web API.
 * Translates OpenAI tools schema into system instructions and parses assistant tool calls.
 */

export function hasTools(tools) {
  return Array.isArray(tools) && tools.length > 0;
}

/**
 * Generate instruction prompt describing the tools and JSON calling format.
 *
 * @param {Array<object>} tools
 * @returns {string}
 */
export function buildToolInstructionPrompt(tools) {
  if (!hasTools(tools)) {
    return '';
  }

  const toolDescriptions = tools
    .map((t, idx) => {
      const fn = t.function || t;
      return (
        `${idx + 1}. Function Name: "${fn.name}"\n` +
        `   Description: ${fn.description || 'No description provided.'}\n` +
        `   Parameters: ${JSON.stringify(fn.parameters || {})}`
      );
    })
    .join('\n\n');

  return (
    `[AVAILABLE TOOLS]\n` +
    `You have access to the following functions/tools:\n\n` +
    `${toolDescriptions}\n\n` +
    `[TOOL USAGE INSTRUCTIONS]\n` +
    `If you need to invoke one or more tools to answer the user's request, you MUST respond ONLY with a JSON object enclosed in a \`\`\`json\`\`\` code fence.\n` +
    `Format:\n` +
    `\`\`\`json\n` +
    `{\n` +
    `  "tool_calls": [\n` +
    `    {\n` +
    `      "name": "function_name",\n` +
    `      "arguments": { "param_name": "value" }\n` +
    `    }\n` +
    `  ]\n` +
    `}\n` +
    `\`\`\`\n` +
    `Rules:\n` +
    `- Output ONLY the JSON code block when calling tools. No greeting, no explanation, no other text.\n` +
    `- "arguments" must be a valid JSON object matching the function's parameters schema.\n` +
    `- If NO tool call is needed, reply normally with natural conversational text and DO NOT use the tool_calls JSON format.`
  );
}

/**
 * Extract plain text or string representation from message content.
 */
export function messageContentToString(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'object' && part.text ? part.text : ''))
      .join('\n');
  }
  return String(content);
}

/**
 * Prepare chat messages including tool prompts and handling tool results.
 *
 * @param {Array<object>} messages
 * @param {Array<object>} [tools]
 * @returns {Array<object>}
 */
export function prepareMessagesForTools(messages, tools) {
  if (!hasTools(tools)) {
    return messages.map((m) => ({
      role: m.role,
      content: messageContentToString(m.content),
    }));
  }

  const toolPrompt = buildToolInstructionPrompt(tools);
  const formattedMessages = [];

  let injected = false;
  for (const m of messages) {
    const role = m.role;
    let text = messageContentToString(m.content);

    // If message is assistant with tool_calls
    if (role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const callsSummary = m.tool_calls
        .map((tc) => `${tc.function?.name || tc.name}(${tc.function?.arguments || JSON.stringify(tc.arguments || {})})`)
        .join(', ');
      text = `[Invoked tools: ${callsSummary}]` + (text ? ` ${text}` : '');
    }

    // If message is a tool response
    if (role === 'tool') {
      text = `[Tool Result for call_id "${m.tool_call_id || 'default'}"]: ${text}`;
    }

    if (role === 'system' && !injected) {
      text = `${text}\n\n${toolPrompt}`;
      injected = true;
    }

    formattedMessages.push({
      role: role === 'tool' ? 'user' : role,
      content: text,
    });
  }

  // If there was no system message, inject tool instructions as the first system message
  if (!injected) {
    formattedMessages.unshift({
      role: 'system',
      content: toolPrompt,
    });
  }

  return formattedMessages;
}

/**
 * Inspect raw LLM response text to see if it emitted a tool call JSON.
 *
 * @param {string} rawText
 * @returns {{ isToolCall: boolean, toolCalls: Array<object>|null, content: string|null }}
 */
export function parseAssistantResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { isToolCall: false, toolCalls: null, content: '' };
  }

  const trimmed = rawText.trim();

  // Pattern 1: fenced code block ```json ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let jsonString = fenceMatch ? fenceMatch[1].trim() : null;

  // Pattern 2: direct JSON object
  if (!jsonString && trimmed.startsWith('{') && trimmed.endsWith('}')) {
    jsonString = trimmed;
  }

  // Pattern 3: substring containing {"tool_calls": ...}
  if (!jsonString) {
    const startIdx = trimmed.indexOf('{"tool_calls"');
    if (startIdx !== -1) {
      const endIdx = trimmed.lastIndexOf('}');
      if (endIdx > startIdx) {
        jsonString = trimmed.slice(startIdx, endIdx + 1);
      }
    }
  }

  if (jsonString) {
    try {
      const parsed = JSON.parse(jsonString);

      // Check standard {"tool_calls": [ { "name": ..., "arguments": ... } ]}
      if (Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
        const toolCalls = parsed.tool_calls.map((tc) => {
          const fnName = tc.name || tc.function?.name;
          const fnArgs = tc.arguments ?? tc.function?.arguments ?? {};
          const argsString = typeof fnArgs === 'string' ? fnArgs : JSON.stringify(fnArgs);
          return {
            id: `call_${crypto.randomBytes(6).toString('hex')}`,
            type: 'function',
            function: {
              name: fnName,
              arguments: argsString,
            },
          };
        });

        return {
          isToolCall: true,
          toolCalls,
          content: null,
        };
      }

      // Check single tool format {"name": ..., "arguments": ...}
      if (parsed.name && (parsed.arguments !== undefined || parsed.parameters !== undefined)) {
        const fnName = parsed.name;
        const fnArgs = parsed.arguments ?? parsed.parameters ?? {};
        const argsString = typeof fnArgs === 'string' ? fnArgs : JSON.stringify(fnArgs);
        return {
          isToolCall: true,
          toolCalls: [
            {
              id: `call_${crypto.randomBytes(6).toString('hex')}`,
              type: 'function',
              function: {
                name: fnName,
                arguments: argsString,
              },
            },
          ],
          content: null,
        };
      }
    } catch {
      // JSON parse error — treat as normal conversational text
    }
  }

  return {
    isToolCall: false,
    toolCalls: null,
    content: rawText,
  };
}
