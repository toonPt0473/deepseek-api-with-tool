import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

export const DEFAULT_PROFILE_DIR = path.resolve(
  process.env.DEEPSEEK_PROFILE_DIR || path.join(ROOT, 'session', 'profile')
);
export const DEFAULT_SESSION_FILE = path.resolve(
  process.env.DEEPSEEK_SESSION_FILE || path.join(ROOT, 'session', 'session.json')
);

// Fallback session file from Python project if present
const PY_SESSION_FILE = path.resolve(ROOT, '..', 'Deepseek-API', 'session', 'session.json');

export const CHAT_URL = 'https://chat.deepseek.com/';
export const SIGNIN_URL = 'https://chat.deepseek.com/sign_in';

export const LAUNCH_ARGS = ['--disable-blink-features=AutomationControlled'];
export const SESSION_MAX_AGE = 6 * 60 * 60; // 6 hours

export class LoginRequiredError extends Error {
  constructor(
    message = 'No DeepSeek session found. Log in first by running:\n' +
      '    npm run login\n' +
      "This opens a browser once so you can sign in and clear the human-check;\n" +
      'afterwards the server reuses the saved session automatically.'
  ) {
    super(message);
    this.name = 'LoginRequiredError';
  }
}

export class Session {
  /**
   * @param {object} params
   * @param {string} params.token
   * @param {Record<string, string>} params.cookies
   * @param {string} params.userAgent
   * @param {number} params.capturedAt
   */
  constructor({ token, cookies, userAgent, capturedAt }) {
    this.token = token;
    this.cookies = cookies;
    this.userAgent = userAgent;
    this.capturedAt = capturedAt;
  }

  get age() {
    return Date.now() / 1000 - this.capturedAt;
  }

  save(filePath = DEFAULT_SESSION_FILE) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          token: this.token,
          cookies: this.cookies,
          user_agent: this.userAgent,
          captured_at: this.capturedAt,
        },
        null,
        2
      ),
      'utf-8'
    );
  }

  static load(filePath = DEFAULT_SESSION_FILE) {
    let target = filePath;
    if (!fs.existsSync(target) && fs.existsSync(PY_SESSION_FILE)) {
      target = PY_SESSION_FILE;
    }
    if (!fs.existsSync(target)) {
      return null;
    }
    try {
      const data = JSON.parse(fs.readFileSync(target, 'utf-8'));
      return new Session({
        token: data.token,
        cookies: data.cookies,
        userAgent: data.user_agent || data.userAgent || '',
        capturedAt: data.captured_at || data.capturedAt || 0,
      });
    } catch {
      return null;
    }
  }
}

export const READ_TOKEN_JS = `
(() => {
  try {
    const raw = window.localStorage.getItem('userToken');
    if (!raw) return null;
    const o = JSON.parse(raw);
    return (o && o.value) ? o.value : null;
  } catch (e) { return null; }
})()
`;

async function safeEvaluate(page, js) {
  try {
    return await page.evaluate(js);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('Execution context was destroyed') || msg.toLowerCase().includes('navigation')) {
      return null;
    }
    throw err;
  }
}

async function captureFromContext(context, page) {
  const token = await safeEvaluate(page, READ_TOKEN_JS);
  if (!token) {
    return null;
  }
  const cookiesList = await context.cookies();
  const cookies = {};
  for (const c of cookiesList) {
    cookies[c.name] = c.value;
  }
  const userAgent = (await safeEvaluate(page, '(() => navigator.userAgent)()')) || '';
  return new Session({
    token,
    cookies,
    userAgent,
    capturedAt: Date.now() / 1000,
  });
}

async function waitForToken(page, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const token = await safeEvaluate(page, READ_TOKEN_JS);
    if (token) {
      return token;
    }
    await page.waitForTimeout(1000);
  }
  return null;
}

async function safeGoto(page, url) {
  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 60000 });
  } catch (err) {
    console.log(`[auth] navigation to ${url} was interrupted (${err?.name || 'Error'}); continuing...`);
  }
  await page.waitForTimeout(2000);
}

async function launchBrowserContext(profileDir, headless) {
  fs.mkdirSync(profileDir, { recursive: true });
  try {
    return await chromium.launchPersistentContext(profileDir, {
      headless,
      channel: 'chrome',
      args: LAUNCH_ARGS,
    });
  } catch {
    return await chromium.launchPersistentContext(profileDir, {
      headless,
      args: LAUNCH_ARGS,
    });
  }
}

/**
 * Interactive login via visible browser window.
 */
export async function login({
  profileDir = DEFAULT_PROFILE_DIR,
  headless = false,
  assumeLoggedOut = false,
} = {}) {
  const context = await launchBrowserContext(profileDir, headless);
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  let existing = null;
  if (!assumeLoggedOut) {
    await safeGoto(page, CHAT_URL);
    existing = await safeEvaluate(page, READ_TOKEN_JS);
  }

  if (!existing) {
    await safeGoto(page, SIGNIN_URL);
    console.log('[auth] Please sign in in the window (solve the human-check if shown). Waiting for session...');
    const token = await waitForToken(page, 300000);
    if (!token) {
      await context.close();
      throw new Error('Login timed out — no token captured.');
    }
  }

  const session = await captureFromContext(context, page);
  await context.close();
  if (!session) {
    throw new Error('Logged in but could not read userToken from localStorage.');
  }
  session.save();
  return session;
}

/**
 * Try to capture token headlessly from persistent profile.
 */
export async function headlessRefresh(profileDir = DEFAULT_PROFILE_DIR) {
  let context;
  try {
    context = await launchBrowserContext(profileDir, true);
  } catch {
    return null;
  }
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  let session = null;
  try {
    await safeGoto(page, CHAT_URL);
    session = await captureFromContext(context, page);
  } catch {
    session = null;
  } finally {
    await context.close();
  }

  if (session) {
    session.save();
  }
  return session;
}

/**
 * Return a usable session: cached file if fresh, else headless refresh, else interactive login.
 */
export async function getSession({
  profileDir = DEFAULT_PROFILE_DIR,
  sessionFile = DEFAULT_SESSION_FILE,
  maxAge = SESSION_MAX_AGE,
  allowInteractive = true,
} = {}) {
  const cached = Session.load(sessionFile);
  if (cached && cached.age < maxAge) {
    return cached;
  }

  const refreshed = await headlessRefresh(profileDir);
  if (refreshed) {
    return refreshed;
  }

  if (!allowInteractive) {
    throw new LoginRequiredError();
  }

  console.log('[auth] No valid session found — opening browser window to log in...');
  return login({ profileDir, assumeLoggedOut: true });
}

// Direct invocation (e.g. node src/auth.js)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  (async () => {
    try {
      const s = await login();
      console.log(`[auth] Successfully captured token: ${s.token.slice(0, 10)}... (${Object.keys(s.cookies).length} cookies)`);
      process.exit(0);
    } catch (err) {
      console.error('[auth] Error:', err.message || err);
      process.exit(1);
    }
  })();
}
