/** 冒烟: 跨团队隔离 → 文档授权 → 共享给我 → 只读保护 → 导出 */
const BASE = 'http://127.0.0.1:3002/api';

async function login(username, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const j = await res.json();
  return j.token ?? j.accessToken ?? j.access_token ?? j.data?.token;
}

const get = async (token, path, expect) => {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const label = `${expect ? `[${expect}] ` : ''}GET ${path} → ${res.status}`;
  return { res, label };
};
const jget = async (token, path) => {
  const { res } = await get(token, path);
  const body = await res.json().catch(() => null);
  return { status: res.status, body: body?.data ?? body };
};

const log = (ok, msg) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);

(async () => {
  const alice = await login('alice', 'Aa123456');
  // 注册一个不属于任何团队的外部用户(已存在则直接登录)
  let carol;
  const reg = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'carol_test', nickname: '跨团队测试', password: 'Cc123456' }),
  });
  const regJ = await reg.json().catch(() => null);
  carol = regJ?.data?.token;
  if (!carol) carol = await login('carol_test', 'Cc123456');
  if (!alice || !carol) return console.log('FAIL  登录失败', { alice: !!alice, carol: !!carol });

  // 1. alice 视角: 团队 + 一篇研发文档(可能在文件夹内,向下钻一层)
  const aliceTeams = (await jget(alice, '/teams')).body;
  const devTeam = aliceTeams.find((t) => t.name.includes('研发')) ?? aliceTeams[0];
  let docs = (await jget(alice, `/documents?teamId=${devTeam.id}`)).body;
  const findDoc = (nodes) => nodes.find((d) => d.docType === 'doc') ?? null;
  let doc = findDoc(docs);
  if (!doc) {
    const folder = docs.find((d) => d.docType === 'folder');
    if (folder) docs = (await jget(alice, `/documents?teamId=${devTeam.id}&parentId=${folder.id}`)).body;
    doc = findDoc(docs);
  }
  log(!!doc, `alice 找到「${devTeam.name}」文档「${doc?.title}」`);

  // 2. carol 跨团队默认不可见
  const carolTeams = (await jget(carol, '/teams')).body;
  log(!carolTeams.some((t) => t.id === devTeam.id), `carol(外部用户)团队列表不含「${devTeam.name}」(共 ${carolTeams.length} 个团队)`);
  const cross = await jget(carol, `/documents?teamId=${devTeam.id}`);
  log(cross.status === 403, `carol 拉取该团队文档树 → ${cross.status}(期望 403)`);

  // 3. carol 此时 shared 为空、详情不可见
  let shared = (await jget(carol, '/documents/shared')).body;
  log(Array.isArray(shared) && shared.length === 0, '授权前 carol 的「共享给我」为空');
  let detail = await jget(carol, `/documents/${doc.id}`);
  log(detail.status === 403, `授权前 carol 读该文档 → ${detail.status}(期望 403)`);

  // 4. alice 授权 carol 只读
  const cands = (await jget(alice, `/teams/${devTeam.id}/candidates?q=carol`)).body;
  const carolUser = cands.find((c) => c.username === 'carol_test');
  if (!carolUser) return console.log('FAIL  candidates 里找不到 carol_test', cands.slice(0, 3));
  const grant = await fetch(`${BASE}/documents/${doc.id}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice}` },
    body: JSON.stringify({ userId: carolUser.id, role: 'viewer' }),
  });
  log(grant.status === 201, `alice 授权 carol 只读 → ${grant.status}`);

  // 5. carol 现在可见 + 只读
  shared = (await jget(carol, '/documents/shared')).body;
  const hit = shared.find((s) => s.id === doc.id);
  log(!!hit, `授权后 carol「共享给我」出现该文档(来源团队 ${hit?.teamName}, myRole=${hit?.myRole})`);
  detail = await jget(carol, `/documents/${doc.id}`);
  log(detail.status === 200 && detail.body.myAction === 'read', `carol 读该文档 → ${detail.status}, myAction=${detail.body?.myAction}(期望 read)`);

  const patched = await fetch(`${BASE}/documents/${doc.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${carol}` },
    body: JSON.stringify({ content: '越权写入测试', version: detail.body.version }),
  });
  log(patched.status === 403, `carol(viewer)尝试编辑保存 → ${patched.status}(期望 403)`);

  // 6. 导出三格式(alice)+ carol 有读权限也能导出
  for (const fmt of ['md', 'html', 'doc']) {
    const { res } = await get(alice, `/documents/${doc.id}/export?format=${fmt}`);
    const cd = res.headers.get('content-disposition') ?? '';
    const ct = res.headers.get('content-type') ?? '';
    log(res.status === 200 && cd.includes('attachment'), `导出 ${fmt} → ${res.status} | ${ct.split(';')[0]} | ${decodeURIComponent(cd.split('filename*=')[1] ?? '')}`);
  }
  const carolExp = (await get(carol, `/documents/${doc.id}/export?format=md`)).res;
  log(carolExp.status === 200, `carol(被授权只读)导出 md → ${carolExp.status}`);

  // 7. 撤销授权 → carol 立即失去访问
  const revoke = await fetch(`${BASE}/documents/${doc.id}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice}` },
    body: JSON.stringify({ userId: carolUser.id, role: '' }),
  });
  const after = await jget(carol, `/documents/${doc.id}`);
  log(revoke.status === 201 && after.status === 403, `撤销授权后 carol 读该文档 → ${after.status}(期望 403,即时生效)`);
})();
