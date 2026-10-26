// 清理验证过程产生的测试数据(差旅制度测试文档 + KB 入库记录)
const BASE = 'http://127.0.0.1:3002/api';
const j = (r) => r.json();
(async () => {
  const login = await j(await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  }));
  const H = { Authorization: `Bearer ${login.data.token}` };

  // 1. 删除 KB 入库记录(连带删除向量并失效检索缓存)
  const kbs = await j(await fetch(`${BASE}/knowledge`, { headers: H }));
  for (const kb of kbs.data || []) {
    const docs = await j(await fetch(`${BASE}/knowledge/${kb.id}/docs`, { headers: H }));
    for (const d of docs.data || []) {
      if (d.sourceName === '差旅制度测试') {
        const r = await fetch(`${BASE}/knowledge/${kb.id}/docs/${d.id}`, { method: 'DELETE', headers: H });
        console.log(`kb-doc removed from ${kb.name}:`, r.status);
      }
    }
  }
  // 2. 删除上传的测试文档
  const r = await fetch(`${BASE}/documents/1dfe025a-c1f3-4d0f-837d-cc7e0c3d76d0`, { method: 'DELETE', headers: H });
  console.log('doc removed:', r.status);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
