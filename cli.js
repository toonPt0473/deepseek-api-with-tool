#!/usr/bin/env node
import { login, getSession, Session } from './src/auth.js';
import { DeepSeekClient } from './src/client.js';

const command = process.argv[2] || 'status';

async function main() {
  switch (command) {
    case 'login': {
      console.log('[cli] Launching browser for DeepSeek interactive login...');
      const session = await login({ headless: false, assumeLoggedOut: true });
      console.log(`[cli] Successfully logged in! Token: ${session.token.slice(0, 12)}...`);
      console.log(`[cli] Saved ${Object.keys(session.cookies).length} cookies.`);
      break;
    }
    case 'status': {
      const session = Session.load();
      if (!session) {
        console.log('[cli] No saved session found.');
        console.log('[cli] Run "node cli.js login" to log in with your DeepSeek account.');
        return;
      }
      const ageMinutes = Math.floor(session.age / 60);
      console.log(`[cli] Saved session found:`);
      console.log(`  - Token: ${session.token.slice(0, 12)}...`);
      console.log(`  - Cookies: ${Object.keys(session.cookies).length}`);
      console.log(`  - Age: ${ageMinutes} minutes`);
      console.log(`  - Status: ${session.age < 6 * 3600 ? 'Fresh (ready to use)' : 'Expired (will auto-refresh)'}`);
      break;
    }
    case 'chat': {
      const prompt = process.argv.slice(3).join(' ') || 'Hello! Tell me a short joke.';
      console.log(`[cli] Prompt: "${prompt}"`);
      const client = new DeepSeekClient();
      console.log('[cli] Sending request to DeepSeek...');
      const reply = await client.chat(prompt);
      console.log('\n--- DeepSeek Response ---');
      console.log(reply.text);
      console.log('-------------------------');
      console.log('Conversation ID:', reply.conversation_id);
      break;
    }
    case 'logout': {
      import('node:fs').then(({ default: fs }) => {
        import('node:path').then(({ default: path }) => {
          const sessionDir = path.resolve('session');
          if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            console.log('[cli] Logged out successfully! Cleared session and browser profile.');
          } else {
            console.log('[cli] No active session found.');
          }
        });
      });
      break;
    }
    case 'switch': {
      const fs = (await import('node:fs')).default;
      const path = (await import('node:path')).default;
      const sessionDir = path.resolve('session');
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log('[cli] Cleared previous session.');
      }
      console.log('[cli] Launching browser for new DeepSeek account login...');
      const session = await login({ headless: false, assumeLoggedOut: true });
      console.log(`[cli] Successfully switched account! New Token: ${session.token.slice(0, 12)}...`);
      break;
    }
    default:
      console.log('Usage:');
      console.log('  node cli.js login          Log into DeepSeek account via browser');
      console.log('  node cli.js logout         Clear current session and browser profile');
      console.log('  node cli.js switch         Switch to another DeepSeek account');
      console.log('  node cli.js status         Check saved session status');
      console.log('  node cli.js chat <prompt>  Test direct chat from CLI');
      break;
  }
}

main().catch((err) => {
  console.error('[cli] Error:', err.message || err);
  process.exit(1);
});
