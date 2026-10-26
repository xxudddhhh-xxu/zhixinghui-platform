# NestJS 后端: pnpm workspace 多阶段构建
# 构建上下文必须是仓库根目录: docker build -f docker/backend.Dockerfile .
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# workspace 图解析需要所有成员包的 package.json 占位
COPY apps/backend/package.json apps/frontend/package.json apps/
RUN pnpm install --frozen-lockfile --filter @zhixinghui/backend...

COPY apps/backend apps/backend
RUN pnpm --filter @zhixinghui/backend build \
  && pnpm --filter @zhixinghui/backend --prod deploy --legacy /pruned

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# pnpm deploy 产物包含生产依赖与 package.json,dist 单独拷入
COPY --from=build /pruned/node_modules ./node_modules
COPY --from=build /pruned/package.json ./package.json
COPY --from=build /app/apps/backend/dist ./dist

EXPOSE 3002
CMD ["node", "dist/main.js"]
