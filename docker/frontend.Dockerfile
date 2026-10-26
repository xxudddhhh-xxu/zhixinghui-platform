# Next.js 前端: standalone 产物多阶段构建
# 构建上下文必须是仓库根目录: docker build -f docker/frontend.Dockerfile --build-arg NEXT_PUBLIC_API_BASE=http://你的域名/api .
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable

# NEXT_PUBLIC_* 在构建期打进客户端包,必须通过 build-arg 提供
ARG NEXT_PUBLIC_API_BASE=http://localhost:3002/api
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
# 容器内启用 standalone 输出(见 next.config.mjs;Windows 本地不开)
ENV NEXT_OUTPUT_STANDALONE=1

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# workspace 图解析需要所有成员包的 package.json 占位
COPY apps/backend/package.json apps/frontend/package.json apps/
RUN pnpm install --frozen-lockfile --filter @zhixinghui/frontend...

COPY apps/frontend apps/frontend
RUN pnpm --filter @zhixinghui/frontend build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3200 HOSTNAME=0.0.0.0
COPY --from=build /app/apps/frontend/.next/standalone ./
COPY --from=build /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=build /app/apps/frontend/public ./apps/frontend/public
# pnpm monorepo 下 standalone 产物嵌套在 apps/frontend/
WORKDIR /app/apps/frontend

EXPOSE 3200
CMD ["node", "server.js"]
