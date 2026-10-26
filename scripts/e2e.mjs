/* 端到端验证脚本: node scripts/e2e.mjs */
const BASE = 'http://localhost:3002/api';

const log = (...a) => console.log('•', ...a);
const ok = (cond, label) => console.log(cond ? `  ✅ ${label}` : `  ❌ ${label}`);

async function req(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

// 1. 登录
const login = await req('POST', '/auth/login', { body: { username: 'admin', password: 'admin123' } });
const admin = login.json?.data?.token;
ok(!!admin, `admin 登录 (${login.status})`);

// 2. 团队与文档
const teams = (await req('GET', '/teams', { token: admin })).json.data;
const rd = teams.find((t) => t.name === '研发团队');
const pd = teams.find((t) => t.name === '产品团队');
ok(!!rd && !!pd, `团队列表: ${teams.map((t) => t.name).join('/')}`);

const rdDocs = (await req('GET', `/documents?teamId=${rd.id}`, { token: admin })).json.data;
const pdDocs = (await req('GET', `/documents?teamId=${pd.id}`, { token: admin })).json.data;
// 文档树懒加载:根为文件夹,需下钻一层取业务文档
const rdRoot = rdDocs.find((d) => d.docType === 'folder');
const pdRoot = pdDocs.find((d) => d.docType === 'folder');
const rdDocs2 = (await req('GET', `/documents?teamId=${rd.id}&parentId=${rdRoot.id}`, { token: admin })).json.data;
const pdDocs2 = (await req('GET', `/documents?teamId=${pd.id}&parentId=${pdRoot.id}`, { token: admin })).json.data;
const apiSpec = rdDocs2.find((d) => d.title === 'API 接口规范');
const travel = pdDocs2.find((d) => d.title === '员工差旅报销制度');
const contract = pdDocs2.find((d) => d.title === '销售合同模板');
ok(!!apiSpec && !!travel && !!contract, `文档树: 研发 ${rdDocs2.length} 项 / 产品 ${pdDocs2.length} 项`);

// 3. 知识库入库(切片→嵌入→Qdrant)
const kbs = (await req('GET', '/knowledge', { token: admin })).json.data;
const rdKb = kbs.find((k) => k.name === '研发知识库');
const pdKb = kbs.find((k) => k.name === '业务知识库');
ok(!!rdKb && !!pdKb, `知识库: ${kbs.map((k) => k.name).join('/')}`);

for (const [kb, doc] of [[rdKb, apiSpec], [pdKb, travel], [pdKb, contract]]) {
  const r = await req('POST', `/knowledge/${kb.id}/ingest-document`, { token: admin, body: { documentId: doc.id } });
  ok(r.json?.data?.chunkCount > 0, `入库「${doc.title}」→ ${r.json?.data?.chunkCount} 个切片`);
}

// 4. 混合检索
const search = await req('POST', '/knowledge/search', {
  token: admin,
  body: { kbIds: [pdKb.id], query: '出差住宿报销标准是多少', topK: 4 },
});
const hits = search.json.data || [];
ok(hits.length > 0 && hits[0].source.includes('差旅'), `混合检索命中: ${hits.map((h) => `${h.source}(${(h.score * 100).toFixed(0)}%)`).join(', ')}`);

// 5. SSE 流式问答
log('SSE 流式问答(含知识库引用)…');
const sseRes = await fetch(BASE + '/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
  body: JSON.stringify({ content: 'P6 员工去上海出差,住宿餐补标准是多少?逾期付款违约金比例?', modelId: 'glm-5.3', kbIds: [pdKb.id] }),
});
ok(sseRes.headers.get('content-type')?.includes('event-stream'), `SSE 响应头 ${sseRes.headers.get('content-type')}`);

const reader = sseRes.body.getReader();
const decoder = new TextDecoder();
let buf = '';
let deltas = 0;
let answerText = '';
let events = new Set();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const blocks = buf.split('\n\n');
  buf = blocks.pop() ?? '';
  for (const b of blocks) {
    const line = b.split('\n').find((l) => l.startsWith('data:'));
    if (!line) continue;
    try {
      const ev = JSON.parse(line.slice(5).trim());
      events.add(ev.type);
      if (ev.type === 'delta') { deltas++; answerText += ev.text; }
      if (ev.type === 'sources') log(`  引用来源: ${ev.sources.map((s) => s.source).join(', ')}`);
      if (ev.type === 'error') log('  ⚠ error 事件:', ev.message);
    } catch {}
  }
}
ok(events.has('meta') && events.has('done'), `SSE 事件链: ${[...events].join(' → ')}`);
ok(deltas > 3, `流式增量片段 ${deltas} 段,回答 ${answerText.length} 字`);
log(`  回答摘要: ${answerText.slice(0, 150).replace(/\n/g, ' ')}…`);

// 6. 权限隔离: 新用户无权访问团队资源(幂等: 已存在则直接登录)
const eveReg = await req('POST', '/auth/register', { body: { username: 'eve_test', password: 'Ee123456', nickname: '隔离测试' } });
const eve = eveReg.json?.data?.token
  ?? (await req('POST', '/auth/login', { body: { username: 'eve_test', password: 'Ee123456' } })).json?.data?.token;
const eveTeams = (await req('GET', '/teams', { token: eve })).json.data;
ok(eveTeams.length === 0, `新用户团队列表为空(${eveTeams.length})`);
const crossDoc = await req('GET', `/documents/${apiSpec.id}`, { token: eve });
ok(crossDoc.status === 403, `越权访问他团队文档被拒 (HTTP ${crossDoc.status})`);
const crossList = await req('GET', `/documents?teamId=${rd.id}`, { token: eve });
ok(crossList.status === 403, `越权列出他团队文档被拒 (HTTP ${crossList.status})`);
const crossKb = await req('POST', '/knowledge/search', { token: eve, body: { kbIds: [pdKb.id], query: '报销' } });
ok(crossKb.status === 403, `越权检索他团队知识库被拒 (HTTP ${crossKb.status})`);

// 7. 版本冲突(先取原文与版本号, 结束后恢复)
const before = (await req('GET', `/documents/${apiSpec.id}`, { token: admin })).json.data;
const patch1 = await req('PATCH', `/documents/${apiSpec.id}`, { token: admin, body: { content: 'A', version: before.version } });
const patch2 = await req('PATCH', `/documents/${apiSpec.id}`, { token: admin, body: { content: 'B', version: before.version } });
ok(patch2.status === 409, `并发编辑冲突检测 (第二次 PATCH ${patch2.status})`);
// 恢复内容
await req('PATCH', `/documents/${apiSpec.id}`, { token: admin, body: { content: before.content, version: patch1.json.data.version } });

// 8. 限流(登录接口 10 次/分钟/IP)
let limited = false;
for (let i = 0; i < 15; i++) {
  const r = await req('POST', '/auth/login', { body: { username: 'nobody', password: 'wrong123' } });
  if (r.status === 429 || r.json?.code === 4290) { limited = true; break; }
}
ok(limited, '高频登录触发限流(429)');

// 9. 运营统计
const overview = (await req('GET', '/dashboard/overview', { token: admin })).json.data;
ok(overview.users >= 4 && overview.messages >= 1, `大屏统计: 用户${overview.users} 团队${overview.teams} 文档${overview.docs} 提问${overview.messages} 平均耗时${overview.avgLatencyMs}ms`);
const trend = (await req('GET', '/dashboard/messages-trend', { token: admin })).json.data;
ok(Array.isArray(trend), `问答趋势 ${trend.length} 天`);

console.log('\n===== 端到端验证完成 =====');
process.exit(0);
