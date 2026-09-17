import { DeepSeekPow } from './pow.js';
import { parseSseStream } from './sse.js';
import { getSession } from './auth.js';
import { DEFAULT_THINKING, DEFAULT_SEARCH } from './config.js';

export const BASE = 'https://chat.deepseek.com';
export const COMPLETION_PATH = '/api/v0/chat/completion';
export const DEFAULT_MODEL_TYPE = 'default';

const CID_SEP = ':';

export function encodeCid(sessionId, messageId, accountName = null) {
  const base = messageId == null ? sessionId : `${sessionId}${CID_SEP}${messageId}`;
  if (accountName) {
    return `${accountName}@${base}`;
  }
  return base;
}

export function decodeCid(conversationId) {
  if (!conversationId) {
    return [null, null, null];
  }
  let target = conversationId;
  let accountName = null;
  if (target.includes('@')) {
    const atIdx = target.indexOf('@');
    accountName = target.slice(0, atIdx) || null;
    target = target.slice(atIdx + 1);
  }
  const parts = target.split(CID_SEP);
  const sessionId = parts[0] || null;
  const parentId = parts[1] && /^\d+$/.test(parts[1]) ? parseInt(parts[1], 10) : null;
  return [sessionId, parentId, accountName];
}

function unwrapBizData(json) {
  if (json.code !== 0) {
    throw new Error(`DeepSeek API error (${json.code}): ${json.msg || JSON.stringify(json)}`);
  }
  const biz = json.data?.biz_data;
  if (!biz) {
    throw new Error(`Unexpected DeepSeek response shape: ${JSON.stringify(json)}`);
  }
  return biz;
}

export class DeepSeekClient {
  /**
   * @param {object} [options]
   * @param {import('./auth.js').Session} [options.session]
   * @param {boolean} [options.allowInteractive=true]
   * @param {string} [options.accountName=null]
   * @param {string} [options.profileDir=null]
   * @param {string} [options.sessionFile=null]
   */
  constructor({ session = null, allowInteractive = true, accountName = null, profileDir = null, sessionFile = null } = {}) {
    this.session = session;
    this.allowInteractive = allowInteractive;
    this.accountName = accountName;
    this.profileDir = profileDir;
    this.sessionFile = sessionFile;
    this.pow = new DeepSeekPow();
  }

  async ensureSession() {
    if (!this.session) {
      this.session = await getSession({
        allowInteractive: this.allowInteractive,
        profileDir: this.profileDir,
        sessionFile: this.sessionFile,
      });
    }
    return this.session;
  }

  _baseHeaders() {
    const cookieHeader = Object.entries(this.session.cookies || {})
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    return {
      authorization: `Bearer ${this.session.token}`,
      accept: '*/*',
      'content-type': 'application/json',
      'user-agent': this.session.userAgent || 'Mozilla/5.0',
      origin: BASE,
      referer: `${BASE}/`,
      'x-app-version': '2.0.0',
      'x-client-version': '2.0.0',
      'x-client-platform': 'web',
      'x-client-locale': 'en_US',
      'x-client-bundle-id': 'com.deepseek.chat',
      'x-client-timezone-offset': '19800',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    };
  }

  async createChatSession() {
    await this.ensureSession();
    const res = await fetch(`${BASE}/api/v0/chat_session/create`, {
      method: 'POST',
      headers: this._baseHeaders(),
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status} on create_chat_session: ${errText}`);
    }

    const data = await res.json();
    return unwrapBizData(data).chat_session.id;
  }

  async _powHeader(targetPath = COMPLETION_PATH) {
    await this.ensureSession();
    const res = await fetch(`${BASE}/api/v0/chat/create_pow_challenge`, {
      method: 'POST',
      headers: this._baseHeaders(),
      body: JSON.stringify({ target_path: targetPath }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status} on create_pow_challenge: ${errText}`);
    }

    const data = await res.json();
    const challenge = unwrapBizData(data).challenge;
    return this.pow.makeHeader(challenge);
  }

  /**
   * Delete a chat session on DeepSeek web backend.
   * @param {string} sessionId
   */
  async deleteChatSession(sessionId) {
    if (!sessionId) return;
    try {
      await this.ensureSession();
      await fetch(`${BASE}/api/v0/chat_session/delete`, {
        method: 'POST',
        headers: this._baseHeaders(),
        body: JSON.stringify({ chat_session_id: sessionId }),
      });
    } catch {
      // ignore deletion errors
    }
  }

  /**
   * Streams completion reply chunks as an async generator.
   *
   * @param {string} prompt
   * @param {object} [options]
   * @param {string} [options.conversationId]
   * @param {string} [options.model]
   * @param {boolean} [options.thinking=false]
   * @param {boolean} [options.search=false]
   * @param {boolean} [options.stateless=true]
   * @returns {AsyncGenerator<string, void, unknown> & { conversationId?: string }}
   */
  stream(
    prompt,
    {
      conversationId = null,
      model = null,
      thinking = DEFAULT_THINKING,
      search = DEFAULT_SEARCH,
      stateless = true,
    } = {}
  ) {
    if (conversationId && model !== null) {
      throw new Error(
        '`model` cannot be set together with `conversation_id`; a thread\'s ' +
          'model is fixed when it is created. Pass `model` only on the first turn.'
      );
    }

    const client = this;
    const streamMeta = { message_id: null, conversation_id: null };

    const asyncGen = (async function* () {
      await client.ensureSession();
      const [decodedSessionId, parentId] = decodeCid(conversationId);
      let sessionId = decodedSessionId;
      let modelType = null;

      if (!sessionId) {
        sessionId = await client.createChatSession();
        modelType = model || DEFAULT_MODEL_TYPE;
      }

      const body = {
        chat_session_id: sessionId,
        parent_message_id: parentId,
        prompt,
        ref_file_ids: [],
        thinking_enabled: Boolean(thinking),
        search_enabled: Boolean(search),
        action: null,
        preempt: false,
      };

      if (modelType !== null) {
        body.model_type = modelType;
      }

      const powHeader = await client._powHeader();
      const headers = {
        ...client._baseHeaders(),
        'x-ds-pow-response': powHeader,
      };

      try {
        const res = await fetch(`${BASE}${COMPLETION_PATH}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status} on completion: ${errText}`);
        }

        const meta = {};
        if (res.body) {
          for await (const delta of parseSseStream(res.body, meta)) {
            yield delta;
          }
        }

        if (meta.message_id != null) {
          streamMeta.message_id = meta.message_id;
          streamMeta.conversation_id = encodeCid(sessionId, meta.message_id, client.accountName);
          asyncGen.conversationId = streamMeta.conversation_id;
        } else {
          const fullCid = encodeCid(sessionId, null, client.accountName);
          streamMeta.conversation_id = fullCid;
          asyncGen.conversationId = fullCid;
        }
      } finally {
        if (stateless && sessionId) {
          // Delete temporary session from DeepSeek backend to avoid caching / clutter
          client.deleteChatSession(sessionId).catch(() => {});
        }
      }
    })();

    asyncGen.getConversationId = () => streamMeta.conversation_id;
    return asyncGen;
  }

  /**
   * Wait for complete chat reply.
   *
   * @param {string} prompt
   * @param {object} [options]
   * @returns {Promise<{ text: string, conversation_id: string }>}
   */
  async chat(prompt, options = {}) {
    const s = this.stream(prompt, options);
    const chunks = [];
    for await (const chunk of s) {
      chunks.push(chunk);
    }
    const text = chunks.join('');
    return {
      text,
      conversation_id: s.conversationId || s.getConversationId(),
    };
  }
}
