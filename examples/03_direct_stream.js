import { DeepSeekClient } from '../src/client.js';

const client = new DeepSeekClient();

async function main() {
  console.log('Streaming answer from DeepSeek:\n');

  const stream = client.stream('Write a short 3-line poem about coding in Node.js');

  for await (const chunk of stream) {
    process.stdout.write(chunk);
  }

  console.log('\n\nConversation ID:', stream.conversationId || stream.getConversationId());
}

main().catch(console.error);
