#!/usr/bin/env node
import { DeepSeekClient } from './src/client.js';
import { AccountManager } from './src/accounts.js';
import { headlessRefresh } from './src/auth.js';

const command = process.argv[2] || 'account:list';

async function main() {
  switch (command) {
    case 'accounts':
    case 'account:list':
    case 'list': {
      const pool = AccountManager.loadPool();
      const accounts = pool.list();

      if (accounts.length === 0) {
        console.log('[cli] No accounts found in pool.');
        console.log('[cli] Run "node cli.js account:add <name>" to register your first account.');
        return;
      }

      console.log(`[cli] Registered DeepSeek Accounts (${accounts.length}):`);
      for (const acc of accounts) {
        const s = acc.getSession();
        const ageMin = s ? Math.floor(s.age / 60) : 'N/A';
        const status = !acc.isAvailable
          ? `🟡 In Cooldown (${acc.cooldownRemainingSec}s remaining)`
          : s
          ? '🟢 Active'
          : '🔴 Missing Session';

        console.log(`\n  • Account: "${acc.name}"`);
        console.log(`    - Status:   ${status}`);
        console.log(`    - Token:    ${s?.token ? s.token.slice(0, 12) + '...' : 'None'}`);
        console.log(`    - Age:      ${ageMin} minutes`);
        console.log(`    - Session:  ${acc.sessionFile}`);
        console.log(`    - Profile:  ${acc.profileDir}`);
      }
      console.log('');
      break;
    }

    case 'account:add':
    case 'add': {
      const name = process.argv[3];
      const email = process.argv[4] || null;
      const password = process.argv[5] || null;

      if (!name) {
        console.error('[cli] Error: Missing account name.');
        console.error('Usage:');
        console.error('  node cli.js account:add <name>                     (Log in manually in browser window)');
        console.error('  node cli.js account:add <name> <email> <password>  (Auto-fill login credentials)');
        process.exit(1);
      }

      console.log(`[cli] Launching browser to log in account "${name}"...`);
      const result = await AccountManager.addAccount(name, {
        headless: false,
        email,
        password,
      });

      console.log(`[cli] Successfully added account "${name}"!`);
      console.log(`[cli] Token: ${result.session.token.slice(0, 12)}...`);
      console.log(`[cli] Saved to: ${result.sessionFile}`);
      break;
    }

    case 'account:refresh':
    case 'refresh': {
      const name = process.argv[3];
      const pool = AccountManager.loadPool();

      const targets = name ? [pool.get(name)].filter(Boolean) : pool.list();
      if (targets.length === 0) {
        console.error(`[cli] Account "${name || 'any'}" not found in pool.`);
        process.exit(1);
      }

      for (const acc of targets) {
        console.log(`[cli] Refreshing session for account "${acc.name}" headlessly...`);
        const s = await headlessRefresh(acc.profileDir, acc.sessionFile);
        if (s) {
          console.log(`[cli] ✅ Successfully refreshed "${acc.name}"! New token: ${s.token.slice(0, 12)}...`);
        } else {
          console.log(`[cli] ⚠️ Could not refresh "${acc.name}" headlessly. Run "node cli.js account:add ${acc.name}" to re-login.`);
        }
      }
      break;
    }

    case 'account:remove':
    case 'remove': {
      const name = process.argv[3];
      if (!name) {
        console.error('[cli] Error: Missing account name to remove.');
        console.error('Usage: node cli.js account:remove <account_name>');
        process.exit(1);
      }

      const ok = AccountManager.removeAccount(name);
      if (ok) {
        console.log(`[cli] Account "${name}" removed successfully.`);
      } else {
        console.log(`[cli] Account "${name}" not found in pool.`);
      }
      break;
    }

    case 'account:test': {
      const name = process.argv[3];
      if (!name) {
        console.error('[cli] Error: Missing account name to test.');
        console.error('Usage: node cli.js account:test <account_name> [prompt]');
        process.exit(1);
      }

      const pool = AccountManager.loadPool();
      const acc = pool.get(name);
      if (!acc) {
        console.error(`[cli] Account "${name}" not found in pool.`);
        process.exit(1);
      }

      const prompt = process.argv.slice(4).join(' ') || 'Hello! Tell me a short joke.';
      console.log(`[cli] Testing account "${name}" with prompt: "${prompt}"...`);
      const reply = await acc.client.chat(prompt);
      console.log('\n--- DeepSeek Response ---');
      console.log(reply.text);
      console.log('-------------------------');
      console.log('Conversation ID:', reply.conversation_id);
      break;
    }

    case 'chat': {
      const prompt = process.argv.slice(3).join(' ') || 'Hello! Tell me a short joke.';
      console.log(`[cli] Prompt: "${prompt}"`);
      const pool = AccountManager.loadPool();
      const { client, account } = pool.selectClient();
      console.log(`[cli] Sending request via account "${account.name}"...`);
      const reply = await client.chat(prompt);
      console.log('\n--- DeepSeek Response ---');
      console.log(reply.text);
      console.log('-------------------------');
      console.log('Conversation ID:', reply.conversation_id);
      break;
    }

    default:
      console.log('DeepSeek CLI - Unified Account Pool Management:');
      console.log('');
      console.log('Commands:');
      console.log('  node cli.js account:list                 List all accounts and status (or: npm run accounts)');
      console.log('  node cli.js account:add <name>           Add an account via browser window');
      console.log('  node cli.js account:add <name> <email> <pwd>  Add an account with auto-filled credentials');
      console.log('  node cli.js account:refresh [name]       Refresh session token(s) headlessly');
      console.log('  node cli.js account:test <name> [prompt] Test chat using a specific account');
      console.log('  node cli.js account:remove <name>        Remove an account from pool');
      console.log('  node cli.js chat <prompt>                Test chat using next available account');
      break;
  }
}

main().catch((err) => {
  console.error('[cli] Error:', err.message || err);
  process.exit(1);
});
