# ---------- 构建阶段 ----------
FROM node:20-alpine AS builder
WORKDIR /app

# better-sqlite3 原生模块编译依赖
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
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
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3030
ENV HOSTNAME=0.0.0.0

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# standalone 输出 + 静态资源与 public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 数据（sqlite）与上传文件目录：运行时用卷持久化
#   docker run -v blog-data:/app/data -v blog-uploads:/app/public/uploads ...
RUN mkdir -p /app/data /app/public/uploads && chown -R nextjs:nodejs /app/data /app/public/uploads

USER nextjs
EXPOSE 3030

CMD ["node", "server.js"]
