# 智星惠 · 在线团队文档协作平台

企业级知识管理 + AI 智能问答一体化平台。基于 **Next.js + NestJS + Python RAG + Qdrant** 构建多团队权限隔离、RAG 混合检索、SSE 流式问答与运营数据大屏。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Next.js 14(App Router,SSG/ISR)、React 18、TypeScript、Ant Design、Zustand、ECharts |
| 后端 | NestJS 10、TypeORM + PostgreSQL、Redis(权限快照/限流/检索缓存)、JWT |
| RAG 服务 | Python FastAPI、Qdrant 向量库、BM25(jieba + rank_bm25)、RRF 混合排序 |
| 基础设施 | Docker Compose(PostgreSQL / Redis / Qdrant)、pnpm monorepo |

## 目录结构

```
apps/frontend    Next.js 前端(端口 3200)
apps/backend     NestJS 后端(端口 3002)
services/rag     Python FastAPI RAG 服务(端口 8000)
scripts/e2e.mjs  端到端验证脚本
docker-compose.yml  基础设施容器
```

## 快速开始

> 端口说明:本机 3000/3001/5432/6379 已被其他服务占用,全套端口做了偏移,互不影响。

```bash
# 1. 启动基础设施(PostgreSQL:5433 / Redis:6380 / Qdrant:6333)
pnpm docker

# 2. 安装依赖(pnpm monorepo)
pnpm install

# 3. 启动 Python RAG 服务
cd services/rag
py -3.13 -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --port 8000

# 4. 启动后端(首次启动自动建表并写入种子数据)
pnpm dev:backend

# 5. 启动前端
pnpm dev:frontend
```

打开 http://localhost:3200

### 演示账号

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| admin | admin123 | 平台管理员 |
| alice | Aa123456 | 研发团队 owner(产品团队 editor) |
| bob | Bb123456 | 产品团队 owner(研发团队 viewer) |

## 环境变量(apps/backend/.env / services/rag/.env)

```ini
# AI 模型(OpenAI 兼容中转)
GLM_BASE_URL / GLM_API_KEY / GLM_MODEL_ID   # 对话模型 glm-5.3
JPT_BASE_URL / JPT_API_KEY / JPT_MODEL_ID   # 备用对话模型
EMBEDDING_ID                                 # 向量模型(见下方降级说明)
```

> **Embedding 降级说明**:当前两个中转均未提供 embedding 通道,RAG 服务在远程向量化失败时**自动降级为本地哈希向量**(jieba 分词 + 特征哈希,1024 维,离线可用),与 BM25 混合检索互补保证召回。`GET /health` 的 `embedding` 字段实时显示当前模式(`remote` / `local-fallback`)。若日后中转开通 embedding 模型,改 `EMBEDDING_ID` 重启即可切回远程语义向量。

## 核心功能与实现对照

### 1. 多团队权限隔离
- 两级权限模型:**团队角色(owner/admin/editor/viewer)+ 文档级覆盖(editor/viewer)**,`effectiveDocAction` 合并计算有效权限。
- **Redis 权限快照**(`perm:snap:{userId}`,TTL 600s),成员变更主动失效,Redis 不可用降级直查库。
- 全局守卫链:JwtAuthGuard → RateLimitGuard → PermissionGuard;`@RequirePermission` 声明式接口鉴权 + 业务层 `assertXxxAccess` 双重校验。
- 前端按权限过滤树形菜单与操作按钮(显隐),文档树接口按 teamId+parentId 懒加载。

### 2. RAG 智能问答(全程流式)
- Python 切片(段落→句子,480/80 重叠)→ 向量化 → **每知识库一个 Qdrant collection**。
- **混合检索**:Embedding 向量检索 ∥ BM25(jieba)关键词检索 → **RRF(k=60) 融合重排**,单路失败自动降级另一路。
- **SSE 流式**:`POST /api/chat/stream` 事件链 `meta → sources → delta(打字机) → done`,15s 心跳,客户端断开中止上游。
- **模型切换 + 工具调用**:面板可切换 GLM/JPT 模型;内置 `knowledge_search` / `calculator`(安全递归下降解析,无 eval)/ `current_time` 工具,最多 3 轮。
- **Redis 检索缓存**:查询结果按 (知识库版本+query) 哈希缓存 300s,入库/删除递增版本号即失效。
- **结果级权限过滤**:命中片段所属知识库必须仍在授权集合内。
- **智能助手**:可配置 AI 角色/性格/可答范围/拒答话术,优先知识库检索,无答案时 AI 兜底回答。

### 3. 性能与渲染优化
- SSG 首页、ISR 公开文档页(`revalidate=60`)、ECharts 按需动态加载(`ssr:false`)。
- 文档树 antd Tree `loadData` 懒加载;编辑器 1.2s 防抖自动保存 + 乐观锁(409 冲突提示"加载最新/覆盖保存")。
- 统一请求封装(`lib/request.ts`):GET 10s 缓存 + 并发去重、401 自动跳登录。

### 4. 安全与容错
- **Redis 固定窗口限流**(登录 10 次/分/IP 等,超限 429;Redis 故障放行降级)。
- **安全审计**:登录/入库/文档操作/权限变更异步落库,大屏可视化 + 管理员查询接口。
- 并发编辑冲突(版本号 409)、向量入库失败状态标记、检索超时单路降级、LLM 失败兜底文案,全链路异常兜底。

### 5. 状态管理与可视化
- Zustand:auth(登录态持久化)/ chat(流式消息状态机)。
- ECharts 运营大屏:用户/团队/文档/提问统计卡、14 天问答趋势、模型调用量分布、各团队文档数、高频提问 TOP、安全审计流水。

## 线上部署架构

| 层 | 托管 | 地址 |
| --- | --- | --- |
| 前端(静态导出) | Cloudflare Pages(连 GitHub,推 main 自动部署) | https://zhixinghui-platform.pages.dev |
| 后端 + RAG | Render Docker 单容器(`deploy/Dockerfile`) | https://zhixinghui-api.onrender.com |
| PostgreSQL | Supabase 免费实例 | - |
| Redis / Qdrant | 缺省不部署,业务自动降级(权限直查库 / BM25 单路检索) | - |

- 前端 `pnpm build:static` 做纯静态导出(`output: 'export'`);ISR 公开文档页在导出模式下由 `/docs/view` 客户端页承担,托管层 `_redirects` 把 `/docs/:id` 重写到该页
- 后端 API 地址在构建期经 `NEXT_PUBLIC_API_BASE` 注入前端产物
- `render.yaml` 为 Render Blueprint:创建服务时按提示填入 Supabase 连接串与模型密钥即可

## 端到端验证

```bash
node scripts/e2e.mjs
```

覆盖:登录 → 团队/文档树 → 文档入库向量化(切片数)→ **混合检索命中率** → **SSE 流式问答(引用来源+正确作答)** → 新用户越权 403×3 → 并发编辑 409 → 高频登录 429 → 大屏统计。

## 常用脚本

```bash
pnpm docker          # 启动/重启基础设施容器
pnpm dev:backend     # 后端开发模式(nest start --watch)
pnpm dev:frontend    # 前端开发模式
pnpm build:backend   # 后端构建
pnpm build:frontend  # 前端构建
```
