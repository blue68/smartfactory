# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: 依赖安装
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

# 安装构建原生模块所需的系统依赖（bcrypt 需要 python3 + make + g++）
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 仅复制 package 文件，利用 Docker 层缓存
COPY package.json package-lock.json* ./

# 安装全部依赖（含 devDependencies，用于编译）
RUN npm cache clean --force && npm ci --include=dev --ignore-scripts && npm rebuild bcrypt --build-from-source

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: 编译 TypeScript
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 编译 TypeScript → dist/
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: 生产镜像（最小化）
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# 添加非 root 用户，提升安全性
RUN addgroup -g 1001 -S appgroup && \
    adduser  -u 1001 -S appuser -G appgroup

WORKDIR /app

# 复用 deps 阶段已安装并编译的依赖，再裁剪为 production 依赖
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* ./
RUN npm prune --omit=dev && rm -rf /tmp/* /root/.npm

# 复制编译产物
COPY --from=builder /app/dist ./dist

# 创建上传目录并赋权给 appuser
RUN mkdir -p /app/uploads && chown appuser:appgroup /app/uploads

# 切换到非 root 用户
USER appuser

# 健康检查：调用 /health 端点
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
