# ---------- 构建阶段 ----------
# 多平台兼容：Hugging Face Spaces / 腾讯云 CloudBase 云托管 / 通用 Docker
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# 允许构建时覆盖前端 API / media 前缀
# - Hugging Face Spaces：留空（同源）
# - CloudBase：填云托管后端的公网访问域名，如 https://trilogy-server-xxx.tcloudbaseapp.com
# - 跨域部署：填任意公网后端域名
ARG VITE_API_BASE=""
ARG VITE_MEDIA_BASE=""
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_MEDIA_BASE=${VITE_MEDIA_BASE}

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

# 数据目录：优先 /data（HF Spaces / CloudBase 挂载点），其次 /app/server/data
RUN mkdir -p /data /app/server/data
ENV DATA_DIR=/data

# 端口由运行环境注入：
# - Hugging Face Spaces：默认 7860
# - CloudBase 云托管：平台注入 PORT（通常 80）
# 本地：默认 8787
# 后端代码已通过 process.env.PORT 读取，无需在此硬编码
ENV PORT=7860
EXPOSE 7860

VOLUME ["/data"]

# 非 root 运行时确保 /data 与 /app 可写
RUN chmod -R a+rw /data /app || true

CMD ["node", "--import", "tsx/esm", "server/src/index.ts"]
