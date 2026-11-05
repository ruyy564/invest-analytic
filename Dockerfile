FROM node:22-alpine AS build
WORKDIR /app
# `better-sqlite3` ставится из prebuilt-бинарника; если для платформы его нет,
# npm уходит в `node-gyp rebuild` — для этого нужны python3, make и g++.
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Данные и шаблон отчёта нужны в рантайме: без них отчёт не соберётся.
COPY data ./data
COPY reports ./reports
RUN mkdir -p /app/data /app/.state
EXPOSE 3000
CMD ["node", "dist/main.js"]
