// 找到带新格式 sources(documentId) 的会话,输出其 id 和首条 source
const fs = await import('node:fs');
const token = fs.readFileSync(process.env.TEMP + '/zxh_token.txt', 'utf8').trim();
const H = { Authorization: `Bearer ${token}` };
const j = (r) => r.json();

const sessions = await j(await fetch('http://127.0.0.1:3002/api/chat/sessions', { headers: H }));
for (const s of sessions.data.slice(0, 6)) {
  const msgs = await j(await fetch(`http://127.0.0.1:3002/api/chat/sessions/${s.id}/messages`, { headers: H }));
  const withSrc = (msgs.data || []).filter((m) => m.role === 'assistant' && m.sources?.length);
  if (withSrc.length) {
    const s0 = withSrc[withSrc.length - 1].sources[0];
    console.log(s.id, '|', s.title.slice(0, 20), '| sources', withSrc[withSrc.length - 1].sources.length,
      '| hasDocId:', 'documentId' in s0, '| textLen:', (s0.text || '').length);
  } else {
    console.log(s.id, '|', s.title.slice(0, 20), '| no sources');
  }
}
