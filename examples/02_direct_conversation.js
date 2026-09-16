import { DeepSeekClient } from '../src/client.js';

const client = new DeepSeekClient();

async function main() {
  console.log('Turn 1: Picking a favorite number...');
  const reply1 = await client.chat('Remember my favorite number is 42.');
  console.log('DeepSeek:', reply1.text);

  // Turn 2: Continue the thread using conversation_id
  console.log('\nTurn 2: Asking what the number was...');
  const reply2 = await client.chat('What is my favorite number?', {
    conversationId: reply1.conversation_id,
  });
  console.log('DeepSeek:', reply2.text);
}

main().catch(console.error);
