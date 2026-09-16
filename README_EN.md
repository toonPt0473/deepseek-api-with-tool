# DeepSeek API (Node.js Edition) 🚀

> **OpenAI-Compatible DeepSeek Bridge in Pure Node.js with Native WebAssembly PoW Solver, Playwright Authentication, and Tool Calling Emulation.**

*(สำหรับภาษาไทย ดูที่ [README_TH.md](README_TH.md) หรือ [README.md](README.md))*

---

## ✨ Key Features & Improvements over Python

| Feature | Python Version | Node.js Version (This Project) |
| :--- | :--- | :--- |
| **Runtime & Dependencies** | Python 3.9+, venv, `wasmtime` runtime | **Node.js 18+ (Pure ESM)**, Native `WebAssembly` engine |
| **Tool Calling / Functions** | ❌ Not supported | ✅ **Built-in Tool Calling Emulation (Shim)** |
| **HTTP Engine** | `httpx` | Built-in Node.js `fetch` & `ReadableStream` |
| **WebAssembly PoW** | External `wasmtime` sandbox | **Native `WebAssembly.Instance`** (Zero native compile) |
| **Server** | FastAPI + Uvicorn | **Express.js** + CORS + Sliding-window Rate Limiter |
| **Tests** | None included | Comprehensive unit test suite with `node --test` |

---

## ⚡ Quick Start

```bash
cd Deepseek-API-Node
npm install
npx playwright install chromium
npm run login
npm start
```

Run tests:
```bash
npm test
```
