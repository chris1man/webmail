FROM node:22-alpine

WORKDIR /app
RUN addgroup -S alerts && adduser -S alerts -G alerts && mkdir /data && chown alerts:alerts /data
COPY server.mjs ./server.mjs
COPY lib ./lib

USER alerts
ENV NODE_ENV=production PORT=8080 STATE_PATH=/data/state.json
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.mjs"]
