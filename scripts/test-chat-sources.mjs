// 验证 chat SSE sources 事件携带 documentId/teamId/text
const BASE = 'http://127.0.0.1:3002/api';
const j = (r) => r.json();
(async () => {
  const fs = await import('node:fs');
  const token = fs.readFileSync(process.env.TEMP + '/zxh_token.txt', 'utf8').trim();
  const kbId = fs.readFileSync(process.env.TEMP + '/zxh_kbid.txt', 'utf8').trim();
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const models = await j(await fetch(`${BASE}/models`, { headers: H }));
  const modelId = models.data?.[0]?.id;
  const sessions = await j(await fetch(`${BASE}/chat/sessions`, { headers: { Authorization: `Bearer ${token}` } }));
  const sessionId = sessions.data?.[0]?.id;

  const r = await fetch(`${BASE}/chat/stream`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ sessionId, content: '差旅住宿标准是多少?', kbIds: [kbId], modelId }),
  });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let sources = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      try {
        const ev = JSON.parse(line.slice(5));
        if (ev.type === 'sources') sources = ev.sources;
        if (ev.type === 'done') {
          console.log('sources =', JSON.stringify((sources || []).map((s) => ({
            source: s.source, score: s.score,
            documentId: s.documentId ? s.documentId.slice(0, 8) + '…' : null,
            teamId: s.teamId ? s.teamId.slice(0, 8) + '…' : null,
            textLen: s.text?.length ?? 0,
          })), null, 1));
          return;
        }
      } catch {}
    }
  }
  console.log('stream ended, sources =', JSON.stringify((sources || []).map((s) => ({
    source: s.source, score: s.score,
    documentId: s.documentId ? s.documentId.slice(0, 8) + '…' : null,
    teamId: s.teamId ? s.teamId.slice(0, 8) + '…' : null,
    textLen: s.text?.length ?? 0,
  })), null, 1));
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
