/**
 * Example 06 — Using standard OpenAI Node.js SDK
 *
 * Install SDK if needed: npm install openai
 * Make sure the server is running: npm start
 */
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:8000/v1',
  apiKey: 'unused', // ignored by local bridge
});

async function main() {
  const completion = await openai.chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: 'You are a concise tech expert.' },
      { role: 'user', content: 'What is WebAssembly in one sentence?' },
    ],
  });

  console.log('OpenAI SDK received answer:');
  console.log(completion.choices[0].message.content);
}

main().catch(console.error);
