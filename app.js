import { createServer } from './src/server.js';
import { HOST, PORT } from './src/config.js';

const app = createServer();

app.listen(PORT, HOST, () => {
  console.log(`DeepSeek OpenAI-compatible API listening on http://${HOST}:${PORT}`);
  console.log(`- Health check: http://${HOST}:${PORT}/healthz`);
  console.log(`- Models list:  http://${HOST}:${PORT}/v1/models`);
  console.log(`- Chat API:     http://${HOST}:${PORT}/v1/chat/completions`);
});
