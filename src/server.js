import express from 'express';
import cors from 'cors';
import {
  MODEL_MAP,
  RATE_LIMIT_PER_MINUTE,
  SERVER_INTERACTIVE_LOGIN,
  DEFAULT_MODEL,
  DEFAULT_THINKING,
  DEFAULT_SEARCH,
  isKnownModel,
  resolveModelType,
} from './config.js';
import { RateLimiter, rateLimitMiddleware } from './ratelimit.js';
import { DeepSeekClient } from './client.js';
import { LoginRequiredError } from './auth.js';
import { messagesToPrompt, completionResponse, streamChunks } from './openai_format.js';
import { hasTools, parseAssistantResponse } from './tool_calling.js';

let sharedClient = null;

export function getClient() {
  if (!sharedClient) {
    sharedClient = new DeepSeekClient({
      allowInteractive: SERVER_INTERACTIVE_LOGIN,
    });
  }
  return sharedClient;
}

export function createServer({ client = null, rateLimit = RATE_LIMIT_PER_MINUTE } = {}) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  const limiter = new RateLimiter(rateLimit, 60.0);
  app.use(rateLimitMiddleware(limiter, '/v1'));

  function errorResponse(res, message, status = 500, errType = 'server_error') {
    return res.status(status).json({
      error: {
        message,
        type: errType,
      },
    });
  }

  // Health check
  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Models list
  app.get('/v1/models', (req, res) => {
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
      return errorResponse(res, '`messages` must be a non-empty array', 400, 'invalid_request_error');
    }

    if (!isKnownModel(model)) {
      return errorResponse(
        res,
        `The model \`${model}\` does not exist. Available models: ${Object.keys(MODEL_MAP).join(', ')}`,
        404,
        'model_not_found'
      );
    }

    const modelType = conversation_id ? null : resolveModelType(model);
    const prompt = messagesToPrompt(messages, tools);

    const dsClient = client || getClient();

    try {
      await dsClient.ensureSession();
    } catch (err) {
      if (err instanceof LoginRequiredError) {
        return errorResponse(res, err.message, 503, 'login_required');
      }
      return errorResponse(res, `Failed to initialize DeepSeek session: ${err.message || err}`, 500);
    }

    // Streaming mode
    if (stream) {
      // If tools are specified, we buffer output to check if the model responded with a tool call
      if (hasTools(tools)) {
        try {
          const reply = await dsClient.chat(prompt, {
            conversationId: conversation_id,
            model: modelType,
            thinking,
            search,
          });

          const parsed = parseAssistantResponse(reply.text);

          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          const cid = 'chatcmpl-' + Math.random().toString(36).substring(2);
          const created = Math.floor(Date.now() / 1000);

          if (parsed.isToolCall) {
            // Emit role frame
            res.write(`data: ${JSON.stringify({
              id: cid,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{
                index: 0,
                delta: { role: 'assistant', content: null, tool_calls: parsed.toolCalls },
                finish_reason: null,
              }],
            })}\n\n`);

            // Emit finish frame
            res.write(`data: ${JSON.stringify({
              id: cid,
              object: 'chat.completion.chunk',
              created,
              model,
              conversation_id: reply.conversation_id,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: 'tool_calls',
              }],
            })}\n\n`);
          } else {
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
              conversation_id: reply.conversation_id,
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
          return errorResponse(res, `DeepSeek request failed: ${err.message || err}`, 500);
        }
      }

      // Standard streaming without tools
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        const textStream = dsClient.stream(prompt, {
          conversationId: conversation_id,
          model: modelType,
          thinking,
          search,
        });

        for await (const chunk of streamChunks(model, textStream)) {
          res.write(chunk);
        }
        res.end();
      } catch (err) {
        if (!res.headersSent) {
          return errorResponse(res, `Streaming failed: ${err.message || err}`, 500);
        }
        res.end();
      }
      return;
    }

    // Non-streaming mode
    try {
      const reply = await dsClient.chat(prompt, {
        conversationId: conversation_id,
        model: modelType,
        thinking,
        search,
      });

      // Handle tool calling emulation if tools were provided
      let toolCalls = null;
      let content = reply.text;

      if (hasTools(tools)) {
        const parsed = parseAssistantResponse(reply.text);
        if (parsed.isToolCall) {
          toolCalls = parsed.toolCalls;
          content = null;
        } else {
          content = parsed.content;
        }
      }

      const responseObj = completionResponse({
        model,
        content,
        toolCalls,
        prompt,
        conversationId: reply.conversation_id,
      });

      return res.json(responseObj);
    } catch (err) {
      return errorResponse(res, `DeepSeek request failed: ${err.message || err}`, 500);
    }
  });

  return app;
}
