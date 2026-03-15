# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: 安装依赖
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# 仅复制 package 文件，利用 Docker 层缓存
COPY package.json package-lock.json* ./

RUN npm install

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: 构建 React 应用
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 构建产物输出到 dist/
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Nginx 生产镜像
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:1.25-alpine AS production

# 移除默认配置
RUN rm /etc/nginx/conf.d/default.conf

# 复制自定义 Nginx 配置
COPY nginx.conf /etc/nginx/conf.d/app.conf

# 复制构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 使用非 root 用户运行（nginx:1.25-alpine 已内置 nginx 用户）
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:80/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
