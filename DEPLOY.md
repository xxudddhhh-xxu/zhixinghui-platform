# 智星惠 · 线上部署指南

一套 Docker 编排把 **前端(Next.js) + 后端(NestJS) + RAG(FastAPI) + PostgreSQL/Redis/Qdrant** 完整搬到任意有 Docker 的服务器,与本地运行方式一致。

## 前置条件

- 一台云服务器(2 核 4G 起步),安装 Docker ≥ 24 与 Docker Compose v2
- 安全组/防火墙放行 `3200`(前端)与 `3002`(后端 API),或只放行 80/443 走 Nginx
- 可用的 GLM/JPT API Key(问答与向量检索依赖)

## 部署步骤

```bash
# 1. 服务器上拿到代码(git clone 或 scp 整个目录)
scp -r "Nest.js+NextJS" root@服务器IP:/opt/zhixinghui

# 2. 配置环境变量
cd /opt/zhixinghui
cp .env.prod.example .env.prod
vi .env.prod          # 改 JWT_SECRET、GLM/JPT 密钥、NEXT_PUBLIC_API_BASE

# 3. 一键构建并启动(首次约 3-6 分钟)
docker compose -f docker-compose.prod.yml up -d --build

# 4. 查看状态与日志
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend
```

验证:浏览器打开 `http://服务器IP:3200`,注册/登录后即可使用;首次启动 `SEED_ON_BOOT=true` 会自动播种演示团队与账号。

## 更新版本

```bash
git pull            # 或重新 scp 覆盖
docker compose -f docker-compose.prod.yml up -d --build
```

数据落在三个 named volume(`zxh_pgdata`/`zxh_redisdata`/`zxh_qdrantdata`),重建容器不丢数据。

## 可选: Nginx + HTTPS 反向代理

只放行 80/443,前端与 API 同域(记得把 `NEXT_PUBLIC_API_BASE` 改为 `https://你的域名/api` 后重新 `--build`):

```nginx
server {
    listen 80;
    server_name 你的域名;
    client_max_body_size 100m;      # 大文件上传上限

    location / {
        proxy_pass http://127.0.0.1:3200;
        proxy_set_header Host $host;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3002/api/;
        proxy_set_header Host $host;
        # SSE 流式问答必需: 关闭缓冲,否则回答不出字
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
    }
}
```

配好后用 certbot 一键上 HTTPS:`certbot --nginx -d 你的域名`。

## 常见问题

- **问答一直转圈**:检查 `GLM_API_KEY` 是否有效;`docker compose -f docker-compose.prod.yml logs -f backend` 看是否报"模型未配置"。
- **改了 NEXT_PUBLIC_API_BASE 不生效**:该变量是构建期注入,改后必须带 `--build` 重新 up。
- **检索无结果**:确认 RAG 容器已起(`logs rag`),且 GLM 中转支持 `EMBEDDING_ID` 对应的向量接口。
- **服务器内存吃紧**:RAG 的 jieba/numpy 常驻约 300-500MB,1G 内存机器建议加 swap。
