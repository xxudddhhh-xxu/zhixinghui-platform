// 逐事件记录 SSE 流,定位断流位置
const fs = await import('node:fs');
const token = fs.readFileSync(process.env.TEMP + '/zxh_token.txt', 'utf8').trim();
const kbId = fs.readFileSync(process.env.TEMP + '/zxh_kbid.txt', 'utf8').trim();

const t0 = Date.now();
const mr = await fetch('http://127.0.0.1:3002/api/llm/models', {
  headers: { Authorization: `Bearer ${token}` },
});
const models = (await mr.json()).data;
const modelId = models[0].id;
console.log('using modelId:', modelId);
const r = await fetch('http://127.0.0.1:3002/api/chat/stream', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: '差旅住宿标准是多少?', kbIds: [kbId], modelId }),
});
console.log('HTTP', r.status);
const reader = r.body.getReader();
const dec = new TextDecoder();
let buf = '';
let deltaCount = 0;
while (true) {
  const { done, value } = await reader.read();
  if (done) { console.log(`+${Date.now() - t0}ms STREAM CLOSED BY SERVER`); break; }
  buf += dec.decode(value, { stream: true });
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.startsWith('data:')) { if (line.trim()) console.log(`+${Date.now() - t0}ms raw:`, line.slice(0, 60)); continue; }
    try {
      const ev = JSON.parse(line.slice(5));
      if (ev.type === 'delta') { deltaCount++; if (deltaCount <= 3 || deltaCount % 20 === 0) console.log(`+${Date.now() - t0}ms delta#${deltaCount}: ${ev.text.slice(0, 20)}`); }
      else console.log(`+${Date.now() - t0}ms ${ev.type}:`, JSON.stringify(ev).slice(0, 140));
    } catch (e) { console.log(`+${Date.now() - t0}ms parse-fail:`, line.slice(0, 80)); }
  }
}
console.log('total deltas:', deltaCount);
