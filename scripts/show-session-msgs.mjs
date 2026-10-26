// 查看指定会话最近消息及 sources 字段
const fs = await import('node:fs');
const token = fs.readFileSync(process.env.TEMP + '/zxh_token.txt', 'utf8').trim();
const sid = process.argv[2];
const r = await fetch(`http://127.0.0.1:3002/api/chat/sessions/${sid}/messages`, {
  headers: { Authorization: `Bearer ${token}` },
});
const j = await r.json();
for (const m of (j.data || []).slice(-4)) {
  const s0 = m.sources?.[0];
  console.log(m.role, '|', (m.content || '').slice(0, 24).replace(/\n/g, ' '),
    '| src:', m.sources?.length ?? 0,
    s0 ? '| keys: ' + Object.keys(s0).join(',') + ' | docId: ' + (s0.documentId || 'NONE') : '');
}
