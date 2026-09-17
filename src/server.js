import express from 'express';
import cors from 'cors';
import {
  MODEL_MAP,
  RATE_LIMIT_PER_MINUTE,
  SERVER_INTERACTIVE_LOGIN,
  DEFAULT_MODEL,
  DEFAULT_THINKING,
  DEFAULT_SEARCH,
  ENABLE_LOGGING,
  ENABLE_COUNTER_LOG,
  isKnownModel,
  resolveModelType,
} from './config.js';
import { RateLimiter, rateLimitMiddleware, getClientKey } from './ratelimit.js';
import { DeepSeekClient } from './client.js';
import { LoginRequiredError } from './auth.js';
import { messagesToPrompt, completionResponse, streamChunks } from './openai_format.js';
import { hasTools, parseAssistantResponse } from './tool_calling.js';
import { getSharedPool } from './accounts.js';

let sharedClient = null;

// Server metrics & request counters
export const stats = {
  totalRequests: 0,
  chatCompletions: 0,
  listModels: 0,
  healthChecks: 0,
  statsRequests: 0,
  startedAt: Date.now(),
};

function getTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Detailed log (only when ENABLE_LOGGING=true)
function logDetails(...args) {
  if (ENABLE_LOGGING) {
    console.log(...args);
  }
}

// Compact Request Counter log (enabled by default via ENABLE_COUNTER_LOG=true)
function logCounter(type, count, total, clientIp, status, durationMs = null, extra = '') {
  if (ENABLE_COUNTER_LOG) {
    const time = getTimestamp();
    const dur = durationMs != null ? ` (${durationMs}ms)` : '';
    const ext = extra ? ` | ${extra}` : '';
    console.log(`[${time}] 📊 Request #${total} (${type} #${count}) | ${clientIp} | ${status}${dur}${ext}`);
  }
}

function truncateText(str, maxLen = 160) {
  if (!str) return '';
  const clean = String(str).replace(/\r?\n|\r/g, ' ').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + '...' : clean;
}

export function getClient() {
  if (!sharedClient) {
    sharedClient = new DeepSeekClient({
      allowInteractive: SERVER_INTERACTIVE_LOGIN,
    });
  }
  return sharedClient;
}

export function createServer({ client = null, accountPool = null, rateLimit = RATE_LIMIT_PER_MINUTE } = {}) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  const limiter = new RateLimiter(rateLimit, 60.0);
  app.use(rateLimitMiddleware(limiter, '/v1'));

  // Health check
  app.get('/healthz', (req, res) => {
    stats.totalRequests++;
    stats.healthChecks++;
    logCounter('Health', stats.healthChecks, stats.totalRequests, getClientKey(req), '200 OK');
    logDetails(`[${getTimestamp()}] 💓 HEALTH CHECK from ${getClientKey(req)} (Health #${stats.healthChecks} | Total: ${stats.totalRequests})`);
    res.json({ status: 'ok' });
  });

  // Server stats & request counters
  app.get('/stats', (req, res) => {
    stats.totalRequests++;
    stats.statsRequests++;
    const uptimeSec = Math.floor((Date.now() - stats.startedAt) / 1000);
    const pool = accountPool || (client ? null : getSharedPool());
    logCounter('Stats', stats.statsRequests, stats.totalRequests, getClientKey(req), '200 OK');
    logDetails(`[${getTimestamp()}] 📊 STATS REQUEST from ${getClientKey(req)} (Stats #${stats.statsRequests} | Total: ${stats.totalRequests})`);
    res.json({
      total_requests: stats.totalRequests,
      chat_completions: stats.chatCompletions,
      models_requests: stats.listModels,
      health_checks: stats.healthChecks,
      stats_requests: stats.statsRequests,
      uptime_seconds: uptimeSec,
      accounts: pool ? pool.getStats() : {},
    });
  });

  // Models list
  app.get('/v1/models', (req, res) => {
    stats.totalRequests++;
    stats.listModels++;
    logCounter('Models', stats.listModels, stats.totalRequests, getClientKey(req), '200 OK');
    logDetails(`[${getTimestamp()}] 📋 LIST MODELS from ${getClientKey(req)} (Models #${stats.listModels} | Total: ${stats.totalRequests})`);
    const created = Math.floor(Date.now() / 1000);
    res.json({
      object: 'list',
      data: Object.keys(MODEL_MAP).map((name) => ({
        id: name,
        object: 'model',
        created,
        owned_by: 'deepseek',
      })),
    });
  });

  // Chat completions
  app.post('/v1/chat/completions', async (req, res) => {
    stats.totalRequests++;
    stats.chatCompletions++;
    const chatIndex = stats.chatCompletions;
    const totalIndex = stats.totalRequests;

    const t0 = Date.now();
    const reqTime = getTimestamp();
    const clientIp = getClientKey(req);

    function errorResponse(message, status = 500, errType = 'server_error') {
      const duration = Date.now() - t0;
      logCounter('Chat', chatIndex, totalIndex, clientIp, `${status} ${errType}`, duration, message);
      logDetails(`[${getTimestamp()}] ❌ ERROR (${status} ${errType}) in ${duration}ms (Chat #${chatIndex} | Total: ${totalIndex})`);
      logDetails(`  • Message:   ${message}`);
      logDetails(`  • Count:     Total Requests So Far = ${stats.totalRequests}`);
      logDetails(`======================================================================`);
      return res.status(status).json({
        error: {
          message,
          type: errType,
        },
      });
    }

    const body = req.body || {};
    const {
      messages,
      model = DEFAULT_MODEL,
      stream = false,
      conversation_id = null,
      tools = null,
    } = body;

    // Allow thinking and search flags either at top level or in extra_body, falling back to defaults
    const thinking = Boolean(body.thinking ?? body.extra_body?.thinking ?? DEFAULT_THINKING);
    const search = Boolean(body.search ?? body.extra_body?.search ?? DEFAULT_SEARCH);

    if (!Array.isArray(messages) || messages.length === 0) {
      return errorResponse('`messages` must be a non-empty array', 400, 'invalid_request_error');
    }

    if (!isKnownModel(model)) {
      return errorResponse(
        `The model \`${model}\` does not exist. Available models: ${Object.keys(MODEL_MAP).join(', ')}`,
        404,
        'model_not_found'
      );
    }

    const modelType = resolveModelType(model);
    const prompt = messagesToPrompt(messages, tools);

    // Pretty console log for incoming request with counter
    const toolNames = hasTools(tools)
      ? tools.map((t) => t.function?.name || t.name).join(', ')
      : 'None';
    const lastMsg = messages[messages.length - 1]?.content;
    const lastMsgSnippet = truncateText(typeof lastMsg === 'string' ? lastMsg : JSON.stringify(lastMsg));

    logDetails(`\n======================================================================`);
    logDetails(`[${reqTime}] 📥 INCOMING REQUEST: POST /v1/chat/completions (Chat #${chatIndex} | Total Requests: ${totalIndex})`);
    logDetails(`  • Client IP: ${clientIp}`);
    logDetails(`  • Model:     ${model} (mode: ${modelType || 'default'})`);
    logDetails(`  • Options:   Stream: ${stream} | Thinking: ${thinking} | Search: ${search}`);
    logDetails(`  • Tools:     ${toolNames}`);
    logDetails(`  • Messages:  ${messages.length} message(s)`);
    logDetails(`  • Last Msg:  "${lastMsgSnippet}"`);
    logDetails(`  • Mode:      Stateless (zero-cache, round-robin)`);
    logDetails(`----------------------------------------------------------------------`);

    const pool = accountPool || (client ? null : getSharedPool());
    let dsClient = client;
    let selectedAccountName = 'single';

    if (pool && pool.size > 0) {
      try {
        const selection = pool.selectClient();
        dsClient = selection.client;
        selectedAccountName = selection.account.name;
      } catch (err) {
        return errorResponse(`Account selection failed: ${err.message || err}`, 503, 'no_accounts_available');
      }
    } else if (!dsClient) {
      dsClient = getClient();
    }

    logDetails(`  • Account:   ${selectedAccountName} [round-robin]`);

    try {
      if (typeof dsClient.ensureSession === 'function') {
        await dsClient.ensureSession();
      }
    } catch (err) {
      if (pool) pool.reportError(selectedAccountName, err);
      if (err instanceof LoginRequiredError) {
        return errorResponse(err.message, 503, 'login_required');
      }
      return errorResponse(`Failed to initialize DeepSeek session: ${err.message || err}`, 500);
    }

    // Streaming mode
    if (stream) {
      // If tools are specified or triggered, buffer output to check if model responded with a tool call
      if (hasTools(tools, messages)) {
        try {
          const reply = await dsClient.chat(prompt, {
            model: modelType,
            thinking,
            search,
            stateless: true,
          });

          const duration = Date.now() - t0;
          const parsed = parseAssistantResponse(reply.text);

          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          const cid = 'chatcmpl-' + Math.random().toString(36).substring(2);
          const created = Math.floor(Date.now() / 1000);

          if (parsed.isToolCall) {
            if (pool) pool.reportSuccess(selectedAccountName);
            logCounter('Chat', chatIndex, totalIndex, clientIp, '200 OK (Tool Call)', duration, `${model} [${selectedAccountName}] -> ${parsed.toolCalls[0]?.function?.name}`);
            logDetails(`[${getTimestamp()}] 🛠️ STREAMED TOOL CALL (200 OK) in ${duration}ms (Chat #${chatIndex})`);
            for (const tc of parsed.toolCalls) {
              logDetails(`  • Function:  ${tc.function.name}`);
              logDetails(`  • Arguments: ${tc.function.arguments}`);
              logDetails(`  • Call ID:   ${tc.id}`);
            }
            logDetails(`  • Thread ID: none (stateless)`);
            logDetails(`  • Request Count: Chat #${chatIndex} | Total: ${stats.totalRequests}`);
            logDetails(`======================================================================`);

            // Emit role frame with indexed tool calls
            res.write(`data: ${JSON.stringify({
              id: cid,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{
                index: 0,
                delta: {
                  role: 'assistant',
                  content: parsed.content || null,
                  tool_calls: parsed.toolCalls.map((tc, idx) => ({
                    index: idx,
                    id: tc.id,
                    type: 'function',
                    function: {
                      name: tc.function.name,
                      arguments: tc.function.arguments,
                    },
                  })),
                },
                finish_reason: null,
              }],
            })}\n\n`);

            // Emit finish frame
            res.write(`data: ${JSON.stringify({
              id: cid,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: 'tool_calls',
              }],
            })}\n\n`);
          } else {
            if (pool) pool.reportSuccess(selectedAccountName);
            logCounter('Chat', chatIndex, totalIndex, clientIp, '200 OK (Stream)', duration, `${model} [${selectedAccountName}]`);
            logDetails(`[${getTimestamp()}] 📤 STREAMED RESPONSE (200 OK) in ${duration}ms (Chat #${chatIndex})`);
            logDetails(`  • Output:    "${truncateText(parsed.content, 250)}"`);
            logDetails(`  • Thread ID: none (stateless)`);
            logDetails(`  • Request Count: Chat #${chatIndex} | Total: ${stats.totalRequests}`);
            logDetails(`======================================================================`);

            // Regular text response
            res.write(`data: ${JSON.stringify({
              id: cid,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{
                index: 0,
                delta: { role: 'assistant', content: '' },
                finish_reason: null,
              }],
            })}\n\n`);

            res.write(`data: ${JSON.stringify({
              id: cid,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{
                index: 0,
                delta: { content: parsed.content },
                finish_reason: null,
              }],
            })}\n\n`);

            res.write(`data: ${JSON.stringify({
              id: cid,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: 'stop',
              }],
            })}\n\n`);
          }

          res.write('data: [DONE]\n\n');
          return res.end();
        } catch (err) {
          if (pool) pool.reportError(selectedAccountName, err);
          return errorResponse(`DeepSeek request failed: ${err.message || err}`, 500);
        }
      }

      // Standard streaming without tools
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      logDetails(`[${getTimestamp()}] ⚡ STREAMING STARTED (200 OK) -> Sending SSE deltas (Chat #${chatIndex})...`);

      try {
        const textStream = dsClient.stream(prompt, {
          model: modelType,
          thinking,
          search,
          stateless: true,
        });

        let streamedText = '';
        let chunkCount = 0;

        for await (const chunk of streamChunks(model, textStream)) {
          res.write(chunk);
          chunkCount++;
          if (chunk.startsWith('data: ') && !chunk.includes('[DONE]')) {
            try {
              const parsed = JSON.parse(chunk.slice(6));
              const deltaContent = parsed.choices?.[0]?.delta?.content;
              if (deltaContent) streamedText += deltaContent;
            } catch {}
          }
        }
        res.end();

        if (pool) pool.reportSuccess(selectedAccountName);
        const duration = Date.now() - t0;
        logCounter('Chat', chatIndex, totalIndex, clientIp, '200 OK (Stream)', duration, `${model} [${selectedAccountName}] (${streamedText.length} chars)`);
        logDetails(`[${getTimestamp()}] ✅ STREAM COMPLETE in ${duration}ms (Chat #${chatIndex})`);
        logDetails(`  • Output:    "${truncateText(streamedText, 250)}"`);
        logDetails(`  • Stats:     ${streamedText.length} chars, ${chunkCount} SSE chunks`);
        logDetails(`  • Request Count: Chat #${chatIndex} | Total: ${stats.totalRequests}`);
        logDetails(`======================================================================`);
      } catch (err) {
        if (pool) pool.reportError(selectedAccountName, err);
        const duration = Date.now() - t0;
        logCounter('Chat', chatIndex, totalIndex, clientIp, `Stream Error`, duration, err.message || err);
        logDetails(`[${getTimestamp()}] ❌ STREAM ERROR in ${duration}ms (Chat #${chatIndex}): ${err.message || err}`);
        logDetails(`======================================================================`);
        if (!res.headersSent) {
          return errorResponse(`Streaming failed: ${err.message || err}`, 500);
        }
        res.end();
      }
      return;
    }

    // Non-streaming mode
    try {
      const reply = await dsClient.chat(prompt, {
        model: modelType,
        thinking,
        search,
        stateless: true,
      });

      const duration = Date.now() - t0;

      // Handle tool calling emulation if tools were provided
      let toolCalls = null;
      let content = reply.text;

      if (hasTools(tools, messages)) {
        const parsed = parseAssistantResponse(reply.text);
        if (parsed.isToolCall) {
          toolCalls = parsed.toolCalls;
          content = parsed.content;
        } else {
          content = parsed.content;
        }
      }

      const responseObj = completionResponse({
        model,
        content,
        toolCalls,
        prompt,
      });

      if (pool) pool.reportSuccess(selectedAccountName);

      if (toolCalls && toolCalls.length > 0) {
        logCounter('Chat', chatIndex, totalIndex, clientIp, '200 OK (Tool Call)', duration, `${model} [${selectedAccountName}] -> ${toolCalls[0].function.name}`);
        logDetails(`[${getTimestamp()}] 🛠️ RESPONSE: TOOL CALL TRIGGERED (200 OK) in ${duration}ms (Chat #${chatIndex})`);
        for (const tc of toolCalls) {
          logDetails(`  • Function:  ${tc.function.name}`);
          logDetails(`  • Arguments: ${tc.function.arguments}`);
          logDetails(`  • Call ID:   ${tc.id}`);
        }
        logDetails(`  • Thread ID: none (stateless)`);
        logDetails(`  • Request Count: Chat #${chatIndex} | Total: ${stats.totalRequests}`);
      } else {
        logCounter('Chat', chatIndex, totalIndex, clientIp, '200 OK', duration, `${model} [${selectedAccountName}]`);
        logDetails(`[${getTimestamp()}] 📤 RESPONSE: (200 OK) in ${duration}ms (Chat #${chatIndex})`);
        logDetails(`  • Output:    "${truncateText(content, 300)}"`);
        logDetails(`  • Tokens:    prompt: ${responseObj.usage.prompt_tokens}, completion: ${responseObj.usage.completion_tokens}, total: ${responseObj.usage.total_tokens}`);
        logDetails(`  • Thread ID: ${reply.conversation_id}`);
        logDetails(`  • Request Count: Chat #${chatIndex} | Total: ${stats.totalRequests}`);
      }
      logDetails(`======================================================================`);

      return res.json(responseObj);
    } catch (err) {
      if (pool) pool.reportError(selectedAccountName, err);
      return errorResponse(`DeepSeek request failed: ${err.message || err}`, 500);
    }
  });

  return app;
}
