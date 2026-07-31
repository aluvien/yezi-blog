# ---------- 构建阶段 ----------
FROM node:20-alpine AS builder
WORKDIR /app

# better-sqlite3 原生模块编译依赖
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# 构建时数据库会写入 /app/data（仅建空表），运行阶段用卷覆盖
RUN npm run build

# ---------- 运行阶段 ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
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
EXPOSE 3000

CMD ["node", "server.js"]
