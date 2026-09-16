/**
 * Server-Sent Events (SSE) parser for DeepSeek's stream protocol.
 */

function captureMessageId(meta, snapshot) {
  if (!meta || !snapshot || typeof snapshot !== 'object') return;
  for (const container of [snapshot.response, snapshot]) {
    if (container && typeof container === 'object') {
      const mid = container.message_id ?? container.id;
      if (typeof mid === 'number') {
        meta.message_id = mid;
        return;
      }
    }
  }
}

/**
 * State-preserving SSE parser across multiple network chunks.
 */
export class SseParser {
  constructor(meta = {}) {
    this.meta = meta;
    this.activePath = null;
    this.currentFragmentType = 'RESPONSE';
    this.emittedInitial = false;
  }

  *feedLines(lines) {
    for (const rawLine of lines) {
      const line = typeof rawLine === 'string' ? rawLine.trim() : '';
      if (!line || !line.startsWith('data:')) {
        continue;
      }
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') {
        continue;
      }

      let obj;
      try {
        obj = JSON.parse(payload);
      } catch {
        continue;
      }

      const v = obj?.v;

      // Snapshot frame: full response object
      if (v && typeof v === 'object' && v.response) {
        captureMessageId(this.meta, v);
        const fragments = v.response.fragments;
        if (Array.isArray(fragments) && fragments.length > 0) {
          const lastFrag = fragments[fragments.length - 1];
          this.currentFragmentType = lastFrag.type || 'RESPONSE';
          for (const frag of fragments) {
            if (frag && frag.type === 'RESPONSE' && frag.content) {
              this.activePath = 'response/fragments/-1/content';
              if (!this.emittedInitial) {
                this.emittedInitial = true;
                yield frag.content;
              }
            } else if (frag && frag.type === 'THINK' && frag.content) {
              this.meta.thinking = (this.meta.thinking || '') + frag.content;
            }
          }
        }
        continue;
      }

      // Appending a new fragment: {"p":"response/fragments","o":"APPEND","v":[{"type":"RESPONSE","content":"Hi"}]}
      if (obj && obj.p === 'response/fragments' && Array.isArray(v) && v.length > 0) {
        const newFrag = v[0];
        if (newFrag && typeof newFrag === 'object') {
          this.currentFragmentType = newFrag.type || 'RESPONSE';
          if (newFrag.type === 'RESPONSE' && newFrag.content) {
            this.activePath = 'response/fragments/-1/content';
            yield newFrag.content;
          } else if (newFrag.type === 'THINK' && newFrag.content) {
            this.meta.thinking = (this.meta.thinking || '') + newFrag.content;
          }
        }
        continue;
      }

      // Path-setting append frame
      if (obj && typeof obj.p === 'string') {
        this.activePath = obj.p;
        if (this.activePath.endsWith('message_id') && typeof v === 'number') {
          this.meta.message_id = v;
        }
        if ((obj.o === 'APPEND' || !obj.o) && typeof v === 'string' && this.activePath.endsWith('content')) {
          if (this.currentFragmentType === 'RESPONSE') {
            yield v;
          } else if (this.currentFragmentType === 'THINK') {
            this.meta.thinking = (this.meta.thinking || '') + v;
          }
        }
        continue;
      }

      // Bare append to the current path
      if (typeof v === 'string' && this.activePath && this.activePath.endsWith('content')) {
        if (this.currentFragmentType === 'RESPONSE') {
          yield v;
        } else if (this.currentFragmentType === 'THINK') {
          this.meta.thinking = (this.meta.thinking || '') + v;
        }
      }
    }
  }
}

/**
 * Parses an iterable or array of SSE lines into response text deltas.
 *
 * @param {Iterable<string>} lines
 * @param {object} [meta] - Object to populate with { message_id, thinking }
 * @yields {string}
 */
export function* parseSseLines(lines, meta = {}) {
  const parser = new SseParser(meta);
  yield* parser.feedLines(lines);
}

/**
 * Parses a ReadableStream or Node.js readable stream line-by-line while preserving state.
 *
 * @param {ReadableStream|AsyncIterable<Uint8Array|string>} stream
 * @param {object} [meta]
 * @yields {string}
 */
export async function* parseSseStream(stream, meta = {}) {
  const parser = new SseParser(meta);
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of stream) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    yield* parser.feedLines(lines);
  }

  if (buffer.trim()) {
    yield* parser.feedLines([buffer]);
  }
}
