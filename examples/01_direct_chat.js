import { DeepSeekClient } from '../src/client.js';

// Create the client once and reuse it.
// It loads (or prompts to capture) your signed-in session automatically.
const client = new DeepSeekClient();

async function main() {
  console.log('Sending message to DeepSeek...');

  // .chat() waits for full response
  const reply = await client.chat('Say hello in one short sentence.', {
    model: 'expert', // 'default' (Instant) or 'expert'
    thinking: true,  // enable DeepThink reasoning
  });

  console.log('\n--- DeepSeek Reply ---');
  console.log(reply.text);
  console.log('----------------------');
  console.log('Conversation ID:', reply.conversation_id);
}

main().catch(console.error);
