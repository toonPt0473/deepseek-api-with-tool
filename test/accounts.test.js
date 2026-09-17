import test from 'node:test';
import assert from 'node:assert/strict';
import { Account, AccountPool } from '../src/accounts.js';
import { createServer } from '../src/server.js';
import { encodeCid, decodeCid } from '../src/client.js';

test('encodeCid and decodeCid: support account name prefix for sticky session', () => {
  // Standard cid
  const cid1 = encodeCid('sess-123', 2);
  assert.equal(cid1, 'sess-123:2');
  const [s1, p1, a1] = decodeCid(cid1);
  assert.equal(s1, 'sess-123');
  assert.equal(p1, 2);
  assert.equal(a1, null);

  // With account name
  const cid2 = encodeCid('sess-456', 5, 'account_a');
  assert.equal(cid2, 'account_a@sess-456:5');
  const [s2, p2, a2] = decodeCid(cid2);
  assert.equal(s2, 'sess-456');
  assert.equal(p2, 5);
  assert.equal(a2, 'account_a');
});

test('AccountPool: Round-Robin load balancing across multiple accounts', () => {
  const pool = new AccountPool();

  const acc1 = new Account({ name: 'acc1', sessionFile: '/dummy1', profileDir: '/dummy1' });
  const acc2 = new Account({ name: 'acc2', sessionFile: '/dummy2', profileDir: '/dummy2' });
  const acc3 = new Account({ name: 'acc3', sessionFile: '/dummy3', profileDir: '/dummy3' });

  pool.register(acc1);
  pool.register(acc2);
  pool.register(acc3);

  assert.equal(pool.size, 3);

  // 6 requests: should cycle 1 -> 2 -> 3 -> 1 -> 2 -> 3
  const order = [];
  for (let i = 0; i < 6; i++) {
    const sel = pool.selectClient();
    order.push(sel.account.name);
    assert.equal(sel.isSticky, false);
  }

  assert.deepEqual(order, ['acc1', 'acc2', 'acc3', 'acc1', 'acc2', 'acc3']);
});

test('AccountPool: Sticky session routes to correct account based on conversationId', () => {
  const pool = new AccountPool();

  const acc1 = new Account({ name: 'acc1', sessionFile: '/dummy1', profileDir: '/dummy1' });
  const acc2 = new Account({ name: 'acc2', sessionFile: '/dummy2', profileDir: '/dummy2' });

  pool.register(acc1);
  pool.register(acc2);

  // Explicit sticky request targeting acc2
  const stickySel = pool.selectClient({ conversationId: 'acc2@thread-999:3' });
  assert.equal(stickySel.account.name, 'acc2');
  assert.equal(stickySel.isSticky, true);

  // Explicit sticky request targeting acc1
  const stickySel1 = pool.selectClient({ conversationId: 'acc1@thread-888:1' });
  assert.equal(stickySel1.account.name, 'acc1');
  assert.equal(stickySel1.isSticky, true);
});

test('AccountPool: Auto-cooldown when account reports 429 rate limit error', () => {
  const pool = new AccountPool({ cooldownDurationMs: 60000 });

  const acc1 = new Account({ name: 'acc1', sessionFile: '/dummy1', profileDir: '/dummy1' });
  const acc2 = new Account({ name: 'acc2', sessionFile: '/dummy2', profileDir: '/dummy2' });

  pool.register(acc1);
  pool.register(acc2);

  // Initial selection gets acc1
  const sel1 = pool.selectClient();
  assert.equal(sel1.account.name, 'acc1');

  // acc1 hits 429 Too Many Requests
  pool.reportError('acc1', new Error('HTTP 429: Too Many Requests / Rate limit exceeded'));
  assert.equal(acc1.isAvailable, false);
  assert.ok(acc1.cooldownRemainingSec > 0);

  // Subsequent requests should completely bypass acc1 and route to acc2
  const sel2 = pool.selectClient();
  assert.equal(sel2.account.name, 'acc2');

  const sel3 = pool.selectClient();
  assert.equal(sel3.account.name, 'acc2');

  // Clear cooldown on acc1 -> acc1 becomes available again
  acc1.clearCooldown();
  assert.equal(acc1.isAvailable, true);
});

test('Server: End-to-end multi-account load balancing and stats reporting', async () => {
  const pool = new AccountPool();

  const client1 = {
    ensureSession: async () => {},
    chat: async () => ({ text: 'Reply from Acc 1', conversation_id: 'acc1@thread-1:1' }),
  };
  const client2 = {
    ensureSession: async () => {},
    chat: async () => ({ text: 'Reply from Acc 2', conversation_id: 'acc2@thread-2:1' }),
  };

  const acc1 = new Account({ name: 'worker_1', sessionFile: '/dummy1', profileDir: '/dummy1' });
  acc1.client = client1;

  const acc2 = new Account({ name: 'worker_2', sessionFile: '/dummy2', profileDir: '/dummy2' });
  acc2.client = client2;

  pool.register(acc1);
  pool.register(acc2);

  const app = createServer({ accountPool: pool });
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // Request 1: should hit worker_1
    const res1 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'hello from req 1' }],
      }),
    });
    assert.equal(res1.status, 200);
    const data1 = await res1.json();
    assert.equal(data1.choices[0].message.content, 'Reply from Acc 1');

    // Request 2: should hit worker_2 (Round-Robin!)
    const res2 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'hello from req 2' }],
      }),
    });
    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    assert.equal(data2.choices[0].message.content, 'Reply from Acc 2');

    // Request 3 (Stateless Round-Robin): cycles back to worker_1
    const res3 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'follow-up' }],
      }),
    });
    assert.equal(res3.status, 200);
    const data3 = await res3.json();
    assert.equal(data3.choices[0].message.content, 'Reply from Acc 1');

    // Verify /stats contains accurate per-account metrics
    const statsRes = await fetch(`http://127.0.0.1:${port}/stats`);
    assert.equal(statsRes.status, 200);
    const stats = await statsRes.json();
    assert.equal(stats.total_requests, 4); // 3 chats + 1 stats
    assert.equal(stats.chat_completions, 3);
    assert.ok(stats.accounts.worker_1);
    assert.ok(stats.accounts.worker_2);
    assert.equal(stats.accounts.worker_1.totalRequests, 2); // req 1 and req 3
    assert.equal(stats.accounts.worker_2.totalRequests, 1); // req 2
  } finally {
    server.close();
  }
});
