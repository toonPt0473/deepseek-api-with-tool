/**
 * Example 07 — Tool Calling (Function Calling) Emulation in Node.js
 *
 * This demonstrates how the Node.js bridge allows LLMs to call external tools
 * (e.g., weather lookup, database queries, calculators) seamlessly!
 */

// Define available tools
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather conditions for a given city',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'The city and state, e.g. Bangkok, Thailand' },
          unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
        },
        required: ['location'],
      },
    },
  },
];

// Mock actual function execution
function executeWeatherTool(args) {
  const { location } = args;
  return JSON.stringify({
    location,
    temperature: '32°C',
    condition: 'Sunny with light clouds',
    humidity: '65%',
  });
}

async function main() {
  const messages = [
    { role: 'user', content: 'What is the weather like in Bangkok right now?' },
  ];

  console.log('1. Sending user query with tool definitions to server...');
  const res1 = await fetch('http://localhost:8000/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      tools,
    }),
  });

  const reply1 = await res1.json();
  const choice = reply1.choices[0];

  if (choice.finish_reason === 'tool_calls') {
    const toolCall = choice.message.tool_calls[0];
    console.log('\n2. Model decided to invoke a tool!');
    console.log('   - Function Name:', toolCall.function.name);
    console.log('   - Arguments:', toolCall.function.arguments);

    // Parse arguments and execute local tool
    const args = JSON.parse(toolCall.function.arguments);
    const toolResult = executeWeatherTool(args);
    console.log('\n3. Executed tool locally. Result:', toolResult);

    // Append assistant's tool call & tool result to messages history
    messages.push(choice.message);
    messages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: toolResult,
    });

    console.log('\n4. Sending tool execution result back to DeepSeek for final answer...');
    const res2 = await fetch('http://localhost:8000/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        tools,
      }),
    });

    const reply2 = await res2.json();
    console.log('\n--- Final Assistant Response ---');
    console.log(reply2.choices[0].message.content);
    console.log('--------------------------------');
  } else {
    console.log('Direct response (no tool needed):');
    console.log(choice.message.content);
  }
}

main().catch(console.error);
