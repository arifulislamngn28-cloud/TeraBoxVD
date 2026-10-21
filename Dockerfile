FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY site.config.js ./
COPY server.js ./
COPY server ./server
COPY public ./public
COPY tools ./tools
COPY bot ./bot

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["node", "server.js"]
