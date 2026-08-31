# ---------- 构建阶段 ----------
FROM node:22-alpine AS builder
WORKDIR /app

# better-sqlite3 原生模块编译依赖
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
# postinstall runs during npm ci, so make its security patch available before dependencies install.
COPY scripts/patch-aplayer.mjs ./scripts/patch-aplayer.mjs
# 可选：国内服务器构建时通过 NPM_REGISTRY 换 npm 镜像源，加速依赖下载
ARG NPM_REGISTRY
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi
RUN npm ci

COPY . .

# NEXT_PUBLIC_* 在构建期内联，需在 build 前通过 --build-arg 注入正式域名，
# 否则镜像内为空，SEO / sitemap / RSS 的绝对链接会失效。
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

# 构建时数据库会写入 /app/data（仅建空表），运行阶段用卷覆盖
RUN npm run build

# ---------- 运行阶段 ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3030
ENV HOSTNAME=0.0.0.0
ENV BLOG_ROOT=/app
ENV BLOG_DB_PATH=/app/data/blog.db

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# standalone 输出 + 静态资源与 public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# SQLite、上传、引用归档和 QQ/Telegram 状态统一在 /app/data；只挂一个卷，
# 避免旧 public/uploads 卷与程序实际 data/uploads 路径再次分叉。
RUN mkdir -p /app/data/uploads && chown -R nextjs:nodejs /app/data

USER nextjs
EXPOSE 3030

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --spider -q http://127.0.0.1:3030/ || exit 1

CMD ["node", "server.js"]
