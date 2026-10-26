# 智星惠后端 + RAG 服务一体镜像(单容器双进程,适配免费托管实例)
# - NestJS 后端:监听 $PORT(托管平台注入),对外提供 /api
# - Python RAG 服务:仅容器内 127.0.0.1:8000,后端经 RAG_SERVICE_URL 调用
# - Redis/Qdrant 缺省时业务自动降级(权限直查库 / BM25 单路检索),无需额外依赖
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app

# 先装依赖(利用层缓存)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/frontend/package.json apps/frontend/
COPY apps/backend/package.json apps/backend/
RUN pnpm install --frozen-lockfile --filter @zhixinghui/backend

# 构建后端
COPY apps/backend apps/backend
RUN pnpm --filter @zhixinghui/backend run build

# Python 虚拟环境与 RAG 依赖
COPY services/rag/requirements.txt services/rag/
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir -r services/rag/requirements.txt

COPY services/rag services/rag
COPY deploy/start-all.sh deploy/start-all.sh

ENV PATH="/opt/venv/bin:$PATH" \
    NODE_ENV=production \
    PORT=3002 \
    RAG_SERVICE_URL=http://127.0.0.1:8000 \
    NODE_OPTIONS=--max-old-space-size=192

EXPOSE 3002
CMD ["bash", "deploy/start-all.sh"]
