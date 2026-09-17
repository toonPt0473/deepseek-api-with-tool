import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session, login, getSession, DEFAULT_PROFILE_DIR, DEFAULT_SESSION_FILE } from './auth.js';
import { DeepSeekClient, decodeCid } from './client.js';
import { SERVER_INTERACTIVE_LOGIN } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

export const ACCOUNTS_DIR = path.resolve(ROOT, 'session', 'accounts');
export const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

export class Account {
  /**
   * @param {object} params
   * @param {string} params.name
   * @param {string} params.sessionFile
   * @param {string} params.profileDir
   * @param {boolean} [params.allowInteractive=true]
   */
  constructor({ name, sessionFile, profileDir, allowInteractive = SERVER_INTERACTIVE_LOGIN }) {
    this.name = name;
    this.sessionFile = sessionFile;
    this.profileDir = profileDir;
    this.allowInteractive = allowInteractive;

    this.cooldownUntil = 0;
    this.totalRequests = 0;
    this.successRequests = 0;
    this.failedRequests = 0;
    this.lastUsedAt = null;

    this.client = new DeepSeekClient({
      allowInteractive: this.allowInteractive,
      accountName: this.name,
      profileDir: this.profileDir,
      sessionFile: this.sessionFile,
    });
  }

  get isAvailable() {
    return Date.now() >= this.cooldownUntil;
  }

  get cooldownRemainingSec() {
    if (this.isAvailable) return 0;
    return Math.max(0, Math.ceil((this.cooldownUntil - Date.now()) / 1000));
  }

  setCooldown(durationMs = DEFAULT_COOLDOWN_MS) {
    this.cooldownUntil = Date.now() + durationMs;
  }

  clearCooldown() {
    this.cooldownUntil = 0;
  }

  getSession() {
    return Session.load(this.sessionFile);
  }
}

export class AccountPool {
  /**
   * @param {object} [options]
   * @param {number} [options.cooldownDurationMs]
   */
  constructor({ cooldownDurationMs = DEFAULT_COOLDOWN_MS } = {}) {
    /** @type {Map<string, Account>} */
    this.accounts = new Map();
    this.rrIndex = 0;
    this.cooldownDurationMs = cooldownDurationMs;
  }

  /**
   * Register or replace an account in the pool.
   * @param {Account} account
   */
  register(account) {
    this.accounts.set(account.name, account);
  }

  /**
   * Remove an account by name.
   * @param {string} name
   */
  remove(name) {
    return this.accounts.delete(name);
  }

  /**
   * Get account by name.
   * @param {string} name
   */
  get(name) {
    return this.accounts.get(name);
  }

  /**
   * List all accounts in the pool.
   * @returns {Account[]}
   */
  list() {
    return Array.from(this.accounts.values());
  }

  /**
   * Get total account count.
   */
  get size() {
    return this.accounts.size;
  }

  /**
   * Select an account for a request.
   * Supports:
   * 1. Sticky session (when conversationId has an encoded account name)
   * 2. Round-Robin across available accounts (not in cooldown)
   * 3. Fallback when all accounts are in cooldown
   *
   * @param {object} [params]
   * @param {string} [params.conversationId]
   * @returns {{ account: Account, client: DeepSeekClient, isSticky: boolean }}
   */
  selectClient({ conversationId = null } = {}) {
    if (this.accounts.size === 0) {
      throw new Error('No DeepSeek accounts registered in AccountPool.');
    }

    // 1. Check for Sticky Session via encoded conversationId
    if (conversationId) {
      const [, , encodedAccountName] = decodeCid(conversationId);
      if (encodedAccountName && this.accounts.has(encodedAccountName)) {
        const stickyAccount = this.accounts.get(encodedAccountName);
        return {
          account: stickyAccount,
          client: stickyAccount.client,
          isSticky: true,
        };
      }
    }

    // 2. Filter available accounts (not in cooldown)
    const all = this.list();
    const available = all.filter((acc) => acc.isAvailable);

    let selected;
    if (available.length > 0) {
      // Round-Robin across available accounts
      selected = available[this.rrIndex % available.length];
      this.rrIndex++;
    } else {
      // All accounts in cooldown — fallback to the one with the earliest cooldown expiry
      selected = all.slice().sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0];
    }

    return {
      account: selected,
      client: selected.client,
      isSticky: false,
    };
  }

  /**
   * Record a successful request.
   * @param {string} accountName
   */
  reportSuccess(accountName) {
    const acc = this.accounts.get(accountName);
    if (!acc) return;
    acc.totalRequests++;
    acc.successRequests++;
    acc.lastUsedAt = Date.now();
  }

  /**
   * Record an error on an account and automatically set cooldown on 429/rate-limit.
   * @param {string} accountName
   * @param {Error|any} error
   */
  reportError(accountName, error) {
    const acc = this.accounts.get(accountName);
    if (!acc) return;
    acc.totalRequests++;
    acc.failedRequests++;
    acc.lastUsedAt = Date.now();

    const msg = String(error?.message || error || '').toLowerCase();
    const isRateLimited =
      msg.includes('429') ||
      msg.includes('rate limit') ||
      msg.includes('too many requests') ||
      msg.includes('quota') ||
      msg.includes('frequency');

    if (isRateLimited) {
      acc.setCooldown(this.cooldownDurationMs);
    }
  }

  /**
   * Returns pool statistics for all accounts.
   */
  getStats() {
    const stats = {};
    for (const [name, acc] of this.accounts.entries()) {
      const session = acc.getSession();
      const ageMinutes = session ? Math.floor(session.age / 60) : null;
      stats[name] = {
        name,
        available: acc.isAvailable,
        inCooldown: !acc.isAvailable,
        cooldownRemainingSec: acc.cooldownRemainingSec,
        totalRequests: acc.totalRequests,
        successRequests: acc.successRequests,
        failedRequests: acc.failedRequests,
        lastUsedAt: acc.lastUsedAt,
        sessionAgeMinutes: ageMinutes,
        hasSession: Boolean(session),
      };
    }
    return stats;
  }
}

export class AccountManager {
  /**
   * Scan disk and populate an AccountPool.
   * Discovers `session/accounts/<name>` and falls back to `session/session.json` if present.
   * @param {AccountPool} [pool]
   * @returns {AccountPool}
   */
  static loadPool(pool = new AccountPool()) {
    fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });

    const entries = fs.readdirSync(ACCOUNTS_DIR, { withFileTypes: true });
    let loadedCount = 0;

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const name = entry.name;
        const dir = path.join(ACCOUNTS_DIR, name);
        const sessionFile = path.join(dir, 'session.json');
        const profileDir = path.join(dir, 'profile');

        const acc = new Account({
          name,
          sessionFile,
          profileDir,
        });
        pool.register(acc);
        loadedCount++;
      }
    }

    // If no accounts found in session/accounts/, migrate legacy session/session.json if it exists
    if (loadedCount === 0 && fs.existsSync(DEFAULT_SESSION_FILE)) {
      const defaultDir = path.join(ACCOUNTS_DIR, 'default');
      fs.mkdirSync(defaultDir, { recursive: true });
      fs.copyFileSync(DEFAULT_SESSION_FILE, path.join(defaultDir, 'session.json'));
      if (fs.existsSync(DEFAULT_PROFILE_DIR)) {
        fs.cpSync(DEFAULT_PROFILE_DIR, path.join(defaultDir, 'profile'), { recursive: true });
      }
      const defaultAcc = new Account({
        name: 'default',
        sessionFile: path.join(defaultDir, 'session.json'),
        profileDir: path.join(defaultDir, 'profile'),
      });
      pool.register(defaultAcc);
    }

    return pool;
  }

  /**
   * Interactively log in a new account and save to session/accounts/<name>
   * @param {string} name
   * @param {object} [options]
   */
  static async addAccount(name, { headless = false, assumeLoggedOut = true, email = null, password = null } = {}) {
    if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(name)) {
      throw new Error('Account name must contain only letters, numbers, underscores, and dashes.');
    }

    const accountDir = path.join(ACCOUNTS_DIR, name);
    const sessionFile = path.join(accountDir, 'session.json');
    const profileDir = path.join(accountDir, 'profile');

    fs.mkdirSync(accountDir, { recursive: true });

    const session = await login({
      profileDir,
      sessionFile,
      headless,
      assumeLoggedOut,
      email,
      password,
    });

    return {
      name,
      session,
      accountDir,
      sessionFile,
      profileDir,
    };
  }

  /**
   * Remove an account and clear its session and profile files.
   * @param {string} name
   */
  static removeAccount(name) {
    const accountDir = path.join(ACCOUNTS_DIR, name);
    if (fs.existsSync(accountDir)) {
      fs.rmSync(accountDir, { recursive: true, force: true });
      return true;
    }
    return false;
  }
}

// Singleton pool instance
let sharedPool = null;

export function getSharedPool() {
  if (!sharedPool) {
    sharedPool = AccountManager.loadPool();
  }
  return sharedPool;
}
