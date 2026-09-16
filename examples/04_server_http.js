// Make sure the server is running: npm start (http://localhost:8000)

async function main() {
  const response = await fetch('http://localhost:8000/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer unused',
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Explain JavaScript promises in two sentences.' }],
    }),
  });

  const data = await response.json();
  console.log('Server response:');
  console.log(data.choices[0].message.content);
  console.log('\nUsage info:', data.usage);
}

main().catch(console.error);
