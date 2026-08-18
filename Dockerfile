FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=3000 \
    TFLEX_API_BASE_URL=https://raw.githubusercontent.com/KrickmanC/T-FLEX-CAD-17-API/main/

COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force
COPY --chown=node:node src ./src

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-$MCP_PORT}/healthz" >/dev/null || exit 1

CMD ["node", "src/http.js"]
