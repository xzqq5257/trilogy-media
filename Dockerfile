# ---------- 构建阶段 ----------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# 先装依赖（利用层缓存）
COPY package.json package-lock.json* ./
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN npm ci --no-audit --no-fund

# 拷源码并构建
COPY . .
RUN npm run build -w client

# ---------- 运行阶段 ----------
FROM node:20-bookworm-slim AS runtime

# 装 ffmpeg（音乐生成 + 媒体探测必需）
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 只装运行时依赖（去掉 devDependencies）
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --omit=dev --no-audit --no-fund

# 拷贝源码 + 前端构建产物
COPY server ./server
COPY --from=builder /app/client/dist ./client/dist

# 数据目录（挂载持久卷）
RUN mkdir -p /app/server/data
ENV DATA_DIR=/app/server/data
ENV PORT=8787

EXPOSE 8787

# 数据卷
VOLUME ["/app/server/data"]

CMD ["node", "--import", "tsx/esm", "server/src/index.ts"]
