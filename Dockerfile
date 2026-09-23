# ---- 小微行业知识库 V3 · Web 版 ----
# 多阶段构建：仅安装生产依赖，镜像更小
FROM node:22-alpine

WORKDIR /app

# 先装依赖，利用 Docker 层缓存
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 再拷代码与数据
COPY server.js tunnel.js ./
COPY public ./public
COPY data/seed.json data/plan19.json ./data/

# 运行时数据库目录（挂载卷以持久化账号与编辑内容）
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=3210
EXPOSE 3210

USER node
CMD ["node", "server.js"]
