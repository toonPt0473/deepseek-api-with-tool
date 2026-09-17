# คู่มือการใช้งาน DeepSeek API (Node.js Edition) 🚀

> **API Bridge สำหรับ DeepSeek พัฒนาด้วย Node.js 100% เชื่อมต่อเว็บแชตฟรีของ DeepSeek ให้กลายเป็น OpenAI-Compatible API พร้อมระบบคำนวณ Proof-of-Work (WASM) และระบบจำลอง Tool Calling (Function Calling) ในตัว**

เอกสารนี้จัดทำขึ้นเพื่อให้คุณสามารถติดตั้ง ตั้งค่า และนำไปใช้งานร่วมกับโปรเจกต์ต่าง ๆ (เช่น OpenAI SDK, LangChain, LlamaIndex, Open WebUI, Dify ฯลฯ) ได้อย่างละเอียดและครบถ้วนที่สุด

---

## 📑 สารบัญ

1. [ภาพรวมและจุดเด่น](#-ภาพรวมและจุดเด่น)
2. [ความต้องการของระบบ](#-ความต้องการของระบบ)
3. [ขั้นตอนการติดตั้ง (Step-by-Step)](#-ขั้นตอนการติดตั้ง-step-by-step)
4. [การเข้าสู่ระบบบัญชี DeepSeek (Auth)](#-การเข้าสู่ระบบบัญชี-deepseek-auth)
5. [การเปิดใช้งาน API Server](#-การเปิดใช้งาน-api-server)
6. [รูปแบบการนำไปเขียนโค้ดใช้งาน](#-รูปแบบการนำไปเขียนโค้ดใช้งาน)
   - [แบบที่ 1: เรียกใช้ตรงใน Node.js (Direct Client)](#แบบที่-1-เรียกใช้ตรงใน-nodejs-direct-client)
   - [แบบที่ 2: คุยต่อเนื่องจำบริบทเดิม (Multi-turn)](#แบบที่-2-คุยต่อเนื่องจำบริบทเดิม-multi-turn)
   - [แบบที่ 3: สตรีมมิ่งคำตอบแบบเรียลไทม์ (Streaming)](#แบบที่-3-สตรีมมิ่งคำตอบแบบเรียลไทม์-streaming)
   - [แบบที่ 4: ใช้งานร่วมกับ OpenAI Official SDK](#แบบที่-4-ใช้งานร่วมกับ-openai-official-sdk)
   - [แบบที่ 5: การใช้งานระบบ Tool Calling (Function Calling)](#แบบที่-5-การใช้งานระบบ-tool-calling-function-calling)
7. [การเชื่อมต่อกับเครื่องมือภายนอก (Open WebUI, LangChain, ฯลฯ)](#-การเชื่อมต่อกับเครื่องมือภายนอก)
8. [รายละเอียด API Endpoints](#-รายละเอียด-api-endpoints)
9. [การตั้งค่าคอนฟิก (.env)](#-การตั้งค่าคอนฟิก-env)
10. [การรัน Unit Tests ตรวจสอบระบบ](#-การรัน-unit-tests-ตรวจสอบระบบ)
11. [คำถามที่พบบ่อยและการแก้ปัญหา (FAQ & Troubleshooting)](#-คำถามที่พบบ่อยและการแก้ปัญหา)

---

## 🌟 ภาพรวมและจุดเด่น

โปรเจกต์นี้เป็นการพอร์ตการทำงานของ DeepSeek API จาก Python มาเป็น **Node.js (Pure ESM)** โดยมีฟีเจอร์เด่นดังนี้:

- 💸 **ฟรี 100%:** ดึงพลังการตอบจากเว็บ [chat.deepseek.com](https://chat.deepseek.com) โดยใช้บัญชีฟรีของคุณเอง ไม่ต้องเสียค่า Token และไม่ต้องผูกบัตรเครดิต
- ⚙️ **Native WebAssembly PoW Solver:** รันโมดูล WebAssembly (`sha3_wasm_bg.wasm`) ของ DeepSeek ผ่าน WebAssembly API แท้ ๆ ของ Node.js ไม่ต้องพึ่งพา Python หรือ `wasmtime` ภายนอก
- 🛠️ **Built-in Tool Calling (Function Calling):** มีระบบ Emulation Middleware ช่วยให้โมเดลสามารถทำ Function Calling ตามมาตรฐาน OpenAI ได้จริง
- 🔌 **OpenAI Drop-in Replacement:** รันเซิร์ฟเวอร์ Express ให้บริการ Endpoint ตามมาตรฐาน OpenAI ทุกประการ
- 🧠 **รองรับ DeepThink (R1) และ Web Search:** สามารถสั่งเปิด-ปิดโหมดคิดวิเคราะห์ (Reasoning) และค้นหาข้อมูลจากอินเทอร์เน็ตได้ในระดับคำขอ

---

## 💻 ความต้องการของระบบ

- **Node.js:** เวอร์ชั่น 18.0.0 ขึ้นไป (แนะนำ Node.js 20 หรือ Node.js 26)
- **ระบบปฏิบัติการ:** macOS, Linux หรือ Windows
- **บัญชีผู้ใช้:** บัญชีฟรีที่สมัครผ่าน [chat.deepseek.com](https://chat.deepseek.com)

---

## 📦 ขั้นตอนการติดตั้ง (Step-by-Step)

### 1. เข้าสู่โฟลเดอร์โปรเจกต์
เปิด Terminal แล้วเข้าไปที่โฟลเดอร์:
```bash
cd Deepseek-API-Node
```

### 2. ติดตั้ง Dependencies
```bash
npm install
```

### 3. ติดตั้งเบราว์เซอร์ Playwright Chromium (ทำครั้งแรกครั้งเดียว)
```bash
npx playwright install chromium
```

---

## 💻 คู่มือการใช้งาน CLI (Command-Line Interface)

โปรเจกต์นี้มีเครื่องมือ CLI ในตัวผ่านไฟล์ `cli.js` (หรือสั่งผ่าน `npm run`) เพื่อจัดการบัญชี ตรวจสอบสถานะ ต่ออายุ Session และทดสอบการแชต

### 📑 สรุปคำสั่งทั้งหมด (CLI Cheatsheet)

| คำสั่ง (npm run) | คำสั่งเต็ม (node cli.js) | คำอธิบาย |
| :--- | :--- | :--- |
| `npm run accounts` | `node cli.js account:list` | แสดงรายการบัญชีทั้งหมดใน Pool และสถานะ (🟢 Active / 🟡 Cooldown) |
| `npm run account:add` | `node cli.js account:add <name>` | เพิ่มบัญชีเข้า Pool (ล็อกอินผ่านเบราว์เซอร์) |
| - | `node cli.js account:add <name> <email> <pwd>` | เพิ่มบัญชีเข้า Pool แบบ **Auto-Fill** (กรอกข้อมูลให้ เหลือแค่เลื่อน Captcha) |
| `npm run account:refresh` | `node cli.js account:refresh [name]` | สั่งต่ออายุ Session เบื้องหลังแบบ **Headless** (ไม่ต้องเปิดหน้าต่าง) |
| - | `node cli.js account:test <name> [prompt]` | ทดสอบยิงแชตเฉพาะบัญชีที่ระบุ |
| `npm run account:remove` | `node cli.js account:remove <name>` | ลบบัญชีออกจาก Pool พร้อมลบโปรไฟล์แคช |
| - | `node cli.js chat "<prompt>"` | ทดสอบยิงข้อความแชตตรงจาก Terminal |

---

### 1. การจัดการบัญชีและ Load Balancer (Account Pool)

ระบบใช้โครงสร้าง **Account Pool** เป็นมาตรฐานเดียวทั้งหมด ไม่ว่าจะใช้งานเพียงบัญชีเดียว หรือหลายบัญชีร่วมกัน โดยข้อมูลแต่ละบัญชีจะถูกจัดเก็บแยกโฟลเดอร์อิสระใน `session/accounts/<name>/`

#### 1.1 การลงทะเบียนบัญชีใหม่เข้าสู่ Pool (`account:add`):
> [!NOTE]
> `<name>` (เช่น `main`, `acc1`, `acc2`) คือ **ชื่อเล่น/ฉลาก** ที่ตั้งขึ้นมาเองสำหรับอ้างอิงในระบบ ไม่ใช่ Email ของ DeepSeek

เนื่องจากหน้าเว็บของ DeepSeek มีระบบ AWS WAF ตรวจจับมนุษย์ เราจึงต้องล็อกอินผ่านเบราว์เซอร์จริง 1 ครั้ง เพื่อดึง Bearer Token และ Cookies มาเก็บไว้ โดยเลือกได้ **2 รูปแบบ**:

* **แบบที่ 1 (กรอกผ่านหน้าต่างเบราว์เซอร์ตามปกติ):**
  ```bash
  node cli.js account:add main
  ```
  1. หน้าต่างเบราว์เซอร์ Chromium จะเด้งขึ้นมาบนหน้าจอ
  2. ให้คุณทำการเข้าสู่ระบบด้วยบัญชี DeepSeek (Email/Password หรือ Google Login)
  3. เลื่อนแก้ Captcha / Human Check ให้เรียบร้อย
  4. เมื่อเข้าสู่หน้าแชตสำเร็จ **หน้าต่างจะปิดลงอัตโนมัติ** และจะบันทึก Session ไว้ที่ `session/accounts/main/`

* **แบบที่ 2 (Auto-Fill ให้สคริปต์พิมพ์ให้อัตโนมัติ ⭐):**
  ```bash
  node cli.js account:add main user@example.com mySecretPassword123
  ```
  สคริปต์จะเปิดเบราว์เซอร์ พิมพ์ Email กับ Password ให้ทันที **คุณมีหน้าที่เพียงแค่เลื่อนจิ๊กซอว์ Captcha ให้ผ่านเท่านั้น**

#### 1.2 การตรวจสอบรายชื่อและสถานะใน Pool (`account:list`):
```bash
npm run accounts
# หรือ: node cli.js
```
```text
[cli] Registered DeepSeek Accounts (2):

  • Account: "main"
    - Status:   🟢 Active
    - Token:    eyJhbGciOi...
    - Age:      5 minutes
    - Session:  session/accounts/main/session.json

  • Account: "acc2"
    - Status:   🟢 Active
    - Token:    eyJzdWIiOi...
    - Age:      12 minutes
    - Session:  session/accounts/acc2/session.json
```

#### 1.3 การรีเฟรชต่ออายุ Session เบื้องหลัง (`account:refresh`):
```bash
# รีเฟรชทุกบัญชีใน pool:
npm run account:refresh

# หรือระบุเฉพาะบัญชี:
node cli.js account:refresh main
```
ระบบจะเปิดเบราว์เซอร์แบบ **ซ่อนหน้าจอ (Headless)** เข้าไปดึง Bearer Token ชุดใหม่มาบันทึกทับไฟล์ให้ทันทีในเวลาไม่กี่วินาที โดยไม่ต้องเปิดหน้าต่างหรือล็อกอินซ้ำ

#### 1.4 การทดสอบและลบบัญชี:
```bash
# ทดสอบแชตผ่านบัญชี main:
node cli.js account:test main "ขอเรื่องตลกสั้นๆ 1 เรื่อง"

# ทดสอบแชตผ่าน Load Balancer:
node cli.js chat "สวัสดี DeepSeek"

# ลบบัญชีออกจาก pool:
node cli.js account:remove acc2
```

---

### 2. หลักการทำงานของ Load Balancer

เมื่อคุณเปิดใช้งานเซิร์ฟเวอร์ด้วย `npm start` ระบบจะโหลดบัญชีทั้งหมดใน Pool มาทำงานร่วมกันอัตโนมัติ:

* **Pure Stateless & Zero-Cache:** ทำงานแบบ Stateless 100% โดยไม่พึ่งพาหรือกักเก็บ `conversation_id` ไว้ ประวัติการสนทนาทั้งหมดจะถูกส่งผ่าน `messages: [...]` และระบบจะสั่งลบ Session ชั่วคราวออกจาก DeepSeek ทันทีหลังตอบกลับเสร็จ ป้องกันปัญหา Session ชนกัน ข้อมูลค้าง หรือห้องแชตรกบน DeepSeek
* **Round-Robin Scheduling:** คำขอแชตจะหมุนเวียนไปยังบัญชีที่มีอยู่ใน Pool อย่างสม่ำเสมอได้ทุกๆ ข้อความ (เช่น `acc1 -> acc2 -> acc3`)
* **Auto-Cooldown on 429 Rate Limit:** หากบัญชีใดเจอ `429 Too Many Requests` ระบบจะพักบัญชีนั้น 10 นาที (Cooldown) และสลับคำขอไปยังบัญชีอื่นที่พร้อมใช้งานแทนทันที
* **Real-time Per-Account Metrics:** สามารถดูสถิติจำนวนครั้งที่แต่ละบัญชีถูกเรียกผ่าน `GET http://127.0.0.1:8000/stats`

---

### 3. กลไกการหมดอายุของ Session & การป้องกันระบบล่ม

Session ของ DeepSeek มีอายุประมาณ **6 ชั่วโมง** ระบบได้วางการป้องกันไว้ 3 ระดับ:

1. **Auto-Refresh ในเบื้องหลัง (อัตโนมัติ 100%):** เมื่อเซสชันใกล้หมดอายุ เซิร์ฟเวอร์จะเรียก `headlessRefresh()` ประจำบัญชีนั้นเพื่อต่ออายุ Token ให้อัตโนมัติโดยที่ผู้ใช้ไม่ต้องทำอะไรเลย
2. **Auto-Cooldown & Failover เมื่อติด 429:** หากบัญชีใดเกิด Rate Limit ระบบจะตั้ง Cooldown พักบัญชีนั้น 10 นาที และโอนคำขอของผู้ใช้ไปยังบัญชีอื่นใน Pool ให้โดยอัตโนมัติ เซิร์ฟเวอร์จึงไม่ล่ม
3. **ตรวจสอบสถิติ Real-time:** สามารถดูสถิติจำนวนครั้งที่แต่ละบัญชีถูกยิง และสถานะ Cooldown ได้ทุกเมื่อผ่าน `GET http://127.0.0.1:8000/stats`

---

## 🚀 การเปิดใช้งาน API Server

เมื่อต้องการเปิดเซิร์ฟเวอร์เพื่อให้บริการ API:

```bash
npm start
# หรือ: node app.js
```

เซิร์ฟเวอร์จะรันที่พอร์ต `8000`:
```text
DeepSeek OpenAI-compatible API listening on http://127.0.0.1:8000
- Health check: http://127.0.0.1:8000/healthz
- Models list:  http://127.0.0.1:8000/v1/models
- Chat API:     http://127.0.0.1:8000/v1/chat/completions
```

---

## 📖 รูปแบบการนำไปเขียนโค้ดใช้งาน

มีตัวอย่างโค้ดพร้อมรันอยู่ในโฟลเดอร์ `examples/` ทั้งหมด 7 รูปแบบ:

### แบบที่ 1: เรียกใช้ตรงใน Node.js (Direct Client)
*(ไม่ต้องเปิดเซิร์ฟเวอร์ — ดูโค้ดได้ที่ [examples/01_direct_chat.js](examples/01_direct_chat.js))*

```javascript
import { DeepSeekClient } from './src/client.js';

const client = new DeepSeekClient();

async function run() {
  const reply = await client.chat('ช่วยอธิบายทฤษฎีควอนตัมแบบเข้าใจง่ายใน 2 ประโยค', {
    model: 'expert', // 'default' (เร็ว) หรือ 'expert' (ฉลาด/R1)
    thinking: true,  // เปิดใช้งาน DeepThink (Reasoning)
    search: false,   // เปิด/ปิดการค้นหาเว็บ
  });

  console.log(reply.text);
  console.log('Conversation ID:', reply.conversation_id);
}

run();
```

---

### แบบที่ 2: คุยต่อเนื่องจำบริบทเดิม (Multi-turn)
*(ดูโค้ดได้ที่ [examples/02_direct_conversation.js](examples/02_direct_conversation.js))*

เมื่อต้องการคุยต่อเนื่อง ให้ส่ง `conversationId` ที่ได้รับจากรอบก่อนหน้ากลับเข้าไป:

```javascript
import { DeepSeekClient } from './src/client.js';

const client = new DeepSeekClient();

async function run() {
  // รอบที่ 1
  const reply1 = await client.chat('จำไว้นะว่าเลขที่ฉันชอบที่สุดคือ 42');
  console.log('รอบที่ 1:', reply1.text);

  // รอบที่ 2: ส่ง conversationId กลับไป
  const reply2 = await client.chat('เลขที่ฉันชอบที่สุดคือเลขอะไร?', {
    conversationId: reply1.conversation_id,
  });
  console.log('รอบที่ 2:', reply2.text);
  // ผลลัพธ์: เลขที่คุณชอบที่สุดคือ 42
}

run();
```

---

### แบบที่ 3: สตรีมมิ่งคำตอบแบบเรียลไทม์ (Streaming)
*(ดูโค้ดได้ที่ [examples/03_direct_stream.js](examples/03_direct_stream.js))*

```javascript
import { DeepSeekClient } from './src/client.js';

const client = new DeepSeekClient();

async function run() {
  const stream = client.stream('แต่งบทกวีสั้น ๆ เกี่ยวกับการเขียนโค้ดด้วย Node.js');

  for await (const chunk of stream) {
    process.stdout.write(chunk); // พิมพ์คำตอบทีละคำทันทีที่ได้รับ
  }
}

run();
```

---

### แบบที่ 4: ใช้งานร่วมกับ OpenAI Official SDK
*(ดูโค้ดได้ที่ [examples/06_server_openai_sdk.js](examples/06_server_openai_sdk.js))*

สามารถนำไลบรารี `openai` ของ Node.js หรือ Python มาชี้ `baseURL` มาที่เซิร์ฟเวอร์ของเราได้ทันที:

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:8000/v1',
  apiKey: 'unused', // ใส่ค่าอะไรก็ได้ ระบบจะไม่ตรวจสอบ
});

async function run() {
  const completion = await openai.chat.completions.create({
    model: 'deepseek-chat', // หรือ 'deepseek-expert'
    messages: [
      { role: 'system', content: 'คุณคือผู้เชี่ยวชาญด้าน JavaScript' },
      { role: 'user', content: 'Event Loop ทำงานอย่างไรแบบย่อ?' },
    ],
  });

  console.log(completion.choices[0].message.content);
}

run();
```

---

### แบบที่ 5: การใช้งานระบบ Tool Calling (Function Calling)
*(ดูโค้ดได้ที่ [examples/07_server_tool_calling.js](examples/07_server_tool_calling.js))*

ตัวอย่างการส่งนิยามฟังก์ชัน (Tools) ให้โมเดลประมวลผล:

```javascript
// 1. นิยามโครงสร้าง Tool ตามมาตรฐาน OpenAI
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'ดึงข้อมูลสภาพอากาศปัจจุบันตามชื่อเมือง',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'ชื่อเมือง เช่น Bangkok, Tokyo' },
        },
        required: ['location'],
      },
    },
  },
];

// 2. ฟังก์ชันจริงที่จะรันในเครื่อง
function executeWeatherTool(args) {
  return JSON.stringify({
    location: args.location,
    temperature: '32°C',
    condition: 'มีเมฆเป็นส่วนมาก',
  });
}

// 3. ส่งคำถามไปยัง API
const messages = [{ role: 'user', content: 'ตอนนี้สภาพอากาศที่กรุงเทพฯ เป็นอย่างไร?' }];

const res1 = await fetch('http://localhost:8000/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'deepseek-chat', messages, tools }),
});

const data1 = await res1.json();
const choice = data1.choices[0];

// ตรวจสอบว่าโมเดลต้องการเรียกใช้ฟังก์ชันหรือไม่
if (choice.finish_reason === 'tool_calls') {
  const toolCall = choice.message.tool_calls[0];
  console.log('โมเดลสั่งเรียกฟังก์ชัน:', toolCall.function.name);
  console.log('พารามิเตอร์:', toolCall.function.arguments);

  // รันฟังก์ชันจริง
  const args = JSON.parse(toolCall.function.arguments);
  const result = executeWeatherTool(args);

  // ส่งผลลัพธ์กลับไปให้ DeepSeek สรุปคำตอบ
  messages.push(choice.message);
  messages.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    content: result,
  });

  const res2 = await fetch('http://localhost:8000/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-chat', messages, tools }),
  });

  const data2 = await res2.json();
  console.log('คำตอบสรุปจาก DeepSeek:', data2.choices[0].message.content);
}
```

---

## 🌐 การเชื่อมต่อกับเครื่องมือภายนอก

คุณสามารถนำ Local API Server นี้ไปเชื่อมต่อกับ Web UI หรือ Agent ต่าง ๆ ได้ง่ายดาย:

| เครื่องมือ | การตั้งค่า |
| :--- | :--- |
| **Open WebUI** | ใส่ `OPENAI_API_BASE_URL=http://localhost:8000/v1` และ `OPENAI_API_KEY=unused` |
| **LangChain / LlamaIndex** | ใช้ `ChatOpenAI(base_url="http://localhost:8000/v1", api_key="unused")` |
| **Dify / NextChat** | เลือกโมเดล OpenAI-API-compatible ตั้ง Base URL เป็น `http://localhost:8000/v1` |
| **Cursor / VSCode Extensions** | ตั้งค่า Custom OpenAI endpoint เป็น `http://localhost:8000/v1` |

---

## 📡 รายละเอียด API Endpoints

| Method | Endpoint | รายละเอียด |
| :--- | :--- | :--- |
| `GET` | `/healthz` | ตรวจสอบความพร้อมของเซิร์ฟเวอร์ (คืนค่า `{"status":"ok"}`) |
| `GET` | `/v1/models` | แสดงรายชื่อโมเดล (`deepseek-chat`, `deepseek-expert`) |
| `POST` | `/v1/chat/completions` | ส่งข้อความแชต (รองรับ `stream`, `tools`, `thinking`, `search`, `conversation_id`) |

---

## ⚙️ การตั้งค่าคอนฟิก (.env)

สามารถสร้างไฟล์ `.env` ที่โฟลเดอร์หลักเพื่อกำหนดค่าเซิร์ฟเวอร์:

```env
# พอร์ตและ IP ของเซิร์ฟเวอร์
HOST=127.0.0.1
PORT=8000

# จำนวน Request สูงสุดต่อนาที ต่อ 1 Client IP (Default: 30)
RATE_LIMIT_PER_MINUTE=30

# อนุญาตให้เปิดหน้าต่างเบราว์เซอร์อัตโนมัติเมื่อ Session หมดอายุ (1 = เปิด, 0 = ปิด)
SERVER_INTERACTIVE_LOGIN=1

# เปิดใช้งาน DeepThink (Reasoning) และ Web Search เป็นค่าเริ่มต้นทุกคำขอ (true/false)
DEFAULT_THINKING=true
DEFAULT_SEARCH=true

# เปิด/ปิดการแสดง Log รายละเอียดเนื้อหา Prompt & Response (true/false)
ENABLE_LOGGING=false

# เปิด/ปิดการแสดง Log นับจำนวน Request Counter บรรทัดเดียว (true/false)
ENABLE_COUNTER_LOG=true
```

> [!TIP]
> - หากต้องการดูเพียงจำนวนครั้งที่มีคนยิงเข้ามาโดยไม่ให้ข้อความ Prompt/Response รกหน้าจอ ให้ตั้ง `ENABLE_LOGGING=false` และ `ENABLE_COUNTER_LOG=true`
> - สามารถดูสถิติจำนวนครั้งแบบละเอียดได้ทุกเมื่อผ่าน API: `GET http://127.0.0.1:8000/stats`

---

## 🧪 การรัน Unit Tests ตรวจสอบระบบ

โปรเจกต์นี้มี Unit Test Suite ครอบคลุม 17 รายการ รันด้วย Node Test Runner ในตัว:

```bash
npm test
```

ผลการทดสอบ:
```text
✔ OpenAI format: estimates tokens
✔ OpenAI format: flattens single user message without prefix
✔ OpenAI format: flattens multi-turn conversation with labels
✔ OpenAI format: creates standard completionResponse
✔ OpenAI format: creates tool_calls completionResponse
✔ OpenAI format: streamChunks yields SSE frames ending in [DONE]
✔ DeepSeekPow: initializes and solves challenge correctly
✔ Server: /healthz returns ok
✔ Server: /v1/models returns model list
✔ Server: /v1/chat/completions rejects empty messages and invalid model
✔ Server: /v1/chat/completions emulates tool calling correctly
✔ SSE parser: parses snapshot and append frames with message_id
✔ SSE parser: stream async generator handles fragmented text chunks
✔ Tool calling: detects tools and builds prompt instructions
✔ Tool calling: prepares messages and injects system instructions
✔ Tool calling: parses tool calls inside fenced JSON code block
✔ Tool calling: returns normal conversational text if no tool called

ℹ tests 17 | pass 17 | fail 0
```

---

## ❓ คำถามที่พบบ่อยและการแก้ปัญหา (FAQ & Troubleshooting)

#### 1. เข้าสู่ระบบแล้วแต่เซิร์ฟเวอร์ยังแจ้งว่า LoginRequired?
**วิธีแก้:** ตรวจสอบไฟล์ `session/session.json` ว่ามีอยู่จริงหรือไม่ หากยังไม่มี ให้รัน `npm run login` ซ้ำอีกครั้งในหน้าต่าง Terminal เพื่อให้เบราว์เซอร์จับค่า Token ใหม่อีกรอบ

#### 2. ได้รับ Error 429 (Rate Limit Exceeded)?
**คำอธิบาย:** เซิร์ฟเวอร์มีการจำกัดความถี่เพื่อป้องกันไม่ให้บัญชี DeepSeek ของคุณถูกระงับ (ค่าเริ่มต้นคือ 30 requests/นาที)  
**วิธีแก้:** คุณสามารถปรับเพิ่มค่า `RATE_LIMIT_PER_MINUTE=60` ในไฟล์ `.env` ได้ แต่แนะนำให้เว้นช่วงการส่ง Request เล็กน้อยเพื่อความปลอดภัยของบัญชี

#### 3. ข้อมูลบัญชีของฉันปลอดภัยหรือไม่?
**คำอธิบาย:** ปลอดภัย 100% ข้อมูลคุกกี้และ Token ทั้งหมดจะถูกเก็บไว้ที่โฟลเดอร์ `session/` ในเครื่องคอมพิวเตอร์ของคุณเท่านั้น และมี `.gitignore` ป้องกันไม่ให้เผลออัปโหลดขึ้น Git

---

## 📄 ลิขสิทธิ์ (License)

เผยแพร่ภายใต้ [MIT License](LICENSE)  
*(โครงการนี้จัดทำขึ้นเพื่อการศึกษาและการใช้งานส่วนบุคคล มิได้เป็นพันธมิตรหรือมีส่วนเกี่ยวข้องอย่างเป็นทางการกับทาง DeepSeek)*
