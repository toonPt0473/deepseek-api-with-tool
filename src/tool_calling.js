import crypto from 'node:crypto';

/**
 * Tool Calling Emulation Layer (Shim) for DeepSeek Web API.
 * Translates OpenAI tools schema into system instructions and parses assistant tool calls.
 */

export function hasTools(tools, messages = []) {
  if (Array.isArray(tools) && tools.length > 0) {
    return true;
  }
  if (Array.isArray(messages)) {
    for (const m of messages) {
      const text = typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content || '');
      if (
        text.includes('[AVAILABLE TOOLS]') ||
        text.includes('DSML') ||
        text.includes('tool_calls')
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Generate instruction prompt describing the tools and JSON / DSML calling formats.
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
    `If you need to invoke one or more tools to answer the user's request, respond with a JSON object enclosed in a \`\`\`json\`\`\` code fence or with native DSML tags.\n` +
    `Format (JSON):\n` +
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
    `Or Format (DSML):\n` +
    `<｜｜DSML｜｜ calls>\n` +
    `<｜｜DSML｜｜ invoke name="function_name">\n` +
    `<｜｜DSML｜｜ parameter name="param_name" string="true">value</｜｜DSML｜｜ parameter>\n` +
    `</｜｜DSML｜｜ invoke>\n` +
    `</｜｜DSML｜｜ calls>\n\n` +
    `Rules:\n` +
    `- Output the tool call block when calling tools.\n` +
    `- "arguments" or parameters must match the function's parameters schema.\n` +
    `- If NO tool call is needed, reply normally with natural conversational text and DO NOT use tool calling syntax.`
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
 * Parse native DeepSeek DSML tags or XML invoke blocks into OpenAI tool calls.
 *
 * Examples:
 * <｜｜DSML｜｜ calls>
 * <｜｜DSML｜｜ invoke name="read">
 * <｜｜DSML｜｜ parameter name="path" string="true">file.txt</｜｜DSML｜｜ parameter>
 * </｜｜DSML｜｜ invoke>
 * </｜｜DSML｜｜ calls>
 *
 * @param {string} rawText
 * @returns {{ isToolCall: boolean, toolCalls: Array<object>, content: string|null }|null}
 */
export function parseDsmlToolCalls(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  // Check if text has any invoke tags (with or without DSML prefix or pipe variations)
  if (!/<[｜|\s]*(?:DSML[｜|\s]*)?invoke\s+name=/i.test(rawText)) {
    return null;
  }

  const invokeRegex = /<[｜|\s]*(?:DSML[｜|\s]*)?invoke\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/[｜|\s]*(?:DSML[｜|\s]*)?invoke>/gi;
  const paramRegex = /<[｜|\s]*(?:DSML[｜|\s]*)?parameter\s+name=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/[｜|\s]*(?:DSML[｜|\s]*)?parameter>/gi;

  const toolCalls = [];
  let invokeMatch;

  while ((invokeMatch = invokeRegex.exec(rawText)) !== null) {
    const fnName = invokeMatch[1];
    const invokeBody = invokeMatch[2];
    const args = {};

    let paramMatch;
    while ((paramMatch = paramRegex.exec(invokeBody)) !== null) {
      const paramName = paramMatch[1];
      const attrs = paramMatch[2] || '';
      const rawVal = paramMatch[3].trim();

      const isString = /string=["']true["']/i.test(attrs);
      if (isString) {
        args[paramName] = rawVal;
      } else {
        try {
          args[paramName] = JSON.parse(rawVal);
        } catch {
          args[paramName] = rawVal;
        }
      }
    }

    toolCalls.push({
      id: `call_${crypto.randomBytes(6).toString('hex')}`,
      type: 'function',
      function: {
        name: fnName,
        arguments: JSON.stringify(args),
      },
    });
  }

  if (toolCalls.length === 0) {
    return null;
  }

  // Strip DSML blocks to get any leading or trailing conversational text
  let cleanContent = rawText;
  cleanContent = cleanContent.replace(/<[｜|\s]*DSML[｜|\s]*(?:calls|tool_calls)[^>]*>[\s\S]*?<\/[｜|\s]*DSML[｜|\s]*(?:calls|tool_calls)>/gi, '');
  cleanContent = cleanContent.replace(/<[｜|\s]*(?:DSML[｜|\s]*)?invoke\s+name=["'][^"']+["'][^>]*>[\s\S]*?<\/[｜|\s]*(?:DSML[｜|\s]*)?invoke>/gi, '');
  cleanContent = cleanContent.trim();

  return {
    isToolCall: true,
    toolCalls,
    content: cleanContent || null,
  };
}

/**
 * Inspect raw LLM response text to see if it emitted a tool call (JSON or DSML).
 *
 * @param {string} rawText
 * @returns {{ isToolCall: boolean, toolCalls: Array<object>|null, content: string|null }}
 */
export function parseAssistantResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { isToolCall: false, toolCalls: null, content: '' };
  }

  // Pattern 1: DeepSeek native DSML tool calls
  const dsmlResult = parseDsmlToolCalls(rawText);
  if (dsmlResult) {
    return dsmlResult;
  }

  const trimmed = rawText.trim();

  // Pattern 2: fenced code block ```json ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let jsonString = fenceMatch ? fenceMatch[1].trim() : null;

  // Pattern 3: direct JSON object
  if (!jsonString && trimmed.startsWith('{') && trimmed.endsWith('}')) {
    jsonString = trimmed;
  }

  // Pattern 4: substring containing {"tool_calls": ...}
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
