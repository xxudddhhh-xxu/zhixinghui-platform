// 验证:中文文件名上传是否乱码 + 检索命中是否携带 documentId/teamId
const BASE = 'http://127.0.0.1:3002/api';
const j = (r) => r.json();

(async () => {
  const login = await j(await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  }));
  const token = login.data.token;
  const H = { Authorization: `Bearer ${token}` };

  const teams = await j(await fetch(`${BASE}/teams`, { headers: H }));
  const teamId = teams.data[0].id;
  console.log('teamId =', teamId);

  // 1. 中文文件名上传(与浏览器一致的 fetch/FormData 路径)
  const content = '# 差旅制度测试\n\n这是用于验证中文文件名上传的测试内容,包含差旅报销关键词。\n';
  const fd = new FormData();
  fd.append('teamId', teamId);
  fd.append('parentId', '');
  fd.append('file', new Blob([content], { type: 'text/markdown' }), '差旅制度测试.md');
  const up = await fetch(`${BASE}/documents/upload`, { method: 'POST', headers: H, body: fd });
  const upJ = await j(up);
  console.log('upload status =', up.status);
  console.log('title =', JSON.stringify(upJ.data?.title ?? upJ));
  const newDocId = upJ.data?.id;

  // 2. 检索命中应带 documentId / teamId
  const kbs = await j(await fetch(`${BASE}/knowledge`, { headers: H }));
  const kb = (kbs.data || []).find((k) => k.teamId === teamId) || kbs.data?.[0];
  if (kb) {
    const ing = await j(await fetch(`${BASE}/knowledge/${kb.id}/ingest-document`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: newDocId }),
    }));
    console.log('ingest =', ing.code === 0 || ing.code === undefined ? 'ok' : JSON.stringify(ing));
    const sr = await j(await fetch(`${BASE}/knowledge/search`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kbIds: [kb.id], query: '差旅', topK: 3 }),
    }));
    const hits = sr.data || [];
    console.log('hits =', hits.length);
    for (const h of hits.slice(0, 3)) {
      console.log('  ->', JSON.stringify({ source: h.source, score: h.score, documentId: h.documentId, teamId: h.teamId }));
    }
    // 3. 命中的 documentId 能否取到文档详情(深链打开原文档的前提)
    const withDoc = hits.find((h) => h.documentId);
    if (withDoc) {
      const d = await fetch(`${BASE}/documents/${withDoc.documentId}`, { headers: H });
      const dj = await j(d);
      console.log('doc fetch =', d.status, JSON.stringify(dj.data?.title));
    } else {
      console.log('NO hit carries documentId!');
    }
  } else {
    console.log('no kb found');
  }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
