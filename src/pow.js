import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_WASM_PATH = path.join(__dirname, 'sha3_wasm_bg.wasm');

/**
 * Proof-of-work solver for DeepSeek's chat completion endpoint.
 *
 * Runs DeepSeek's own WebAssembly module (sha3_wasm_bg.wasm) using native
 * Node.js WebAssembly runtime.
 */
export class DeepSeekPow {
  /**
   * @param {string} [wasmPath]
   */
  constructor(wasmPath = DEFAULT_WASM_PATH) {
    this.wasmPath = wasmPath;
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = new WebAssembly.Module(wasmBuffer);
    this._instance = new WebAssembly.Instance(wasmModule, {});
    const exp = this._instance.exports;

    this._memory = exp.memory;
    this._solve = exp.wasm_solve;
    this._malloc = exp.__wbindgen_export_0; // malloc(size, align)
    this._addToStack = exp.__wbindgen_add_to_stack_pointer;
  }

  /**
   * Allocate memory and copy UTF-8 string into wasm memory; returns [ptr, len].
   * @param {string} text
   * @returns {[number, number]}
   */
  _writeStr(text) {
    const data = Buffer.from(text, 'utf-8');
    const ptr = this._malloc(data.length, 1);
    const mem = new Uint8Array(this._memory.buffer);
    mem.set(data, ptr);
    return [ptr, data.length];
  }

  /**
   * Return integer PoW answer, or null if solving fails or expires.
   * Mirrors the website's wasm-bindgen call:
   *   wasm_solve(retptr, challenge_ptr, challenge_len, prefix_ptr, prefix_len, difficulty)
   *
   * @param {string} challenge
   * @param {string} prefix
   * @param {number} difficulty
   * @returns {number|null}
   */
  solve(challenge, prefix, difficulty) {
    const retptr = this._addToStack(-16);
    try {
      const [cPtr, cLen] = this._writeStr(challenge);
      const [pPtr, pLen] = this._writeStr(prefix);
      this._solve(retptr, cPtr, cLen, pPtr, pLen, Number(difficulty));

      const view = new DataView(this._memory.buffer);
      const status = view.getInt32(retptr, true);
      const value = view.getFloat64(retptr + 8, true);

      if (status === 0) {
        return null;
      }
      return Math.floor(value);
    } finally {
      this._addToStack(16);
    }
  }

  /**
   * Build base64 `x-ds-pow-response` header value from a challenge object.
   * @param {object} challenge
   * @returns {string}
   */
  makeHeader(challenge) {
    const prefix = `${challenge.salt}_${challenge.expire_at}_`;
    const answer = this.solve(challenge.challenge, prefix, challenge.difficulty);
    if (answer === null) {
      throw new Error('PoW solver returned no answer (challenge expired or invalid)');
    }
    const payload = {
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      salt: challenge.salt,
      answer: answer,
      signature: challenge.signature,
      target_path: challenge.target_path,
    };
    const raw = Buffer.from(JSON.stringify(payload), 'utf-8');
    return raw.toString('base64');
  }
}
