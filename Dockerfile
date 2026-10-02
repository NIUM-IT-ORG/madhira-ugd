# Madhira UGD Tracker: one image with the API server, the built web app and the map data.

# ---- build the web app
FROM node:24-alpine AS web
WORKDIR /app
COPY shared ./shared
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
RUN cd web && npm run build

# ---- runtime
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    VAR_DIR=/var/lib/ugd \
    DATA_DIR=/app/data/processed \
    WEB_DIR=/app/web/dist
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force
COPY server/src ./server/src
# Post-deployment checks, runnable inside the container: node server/test/postdeploy-check.mjs <url>
COPY server/test ./server/test
COPY shared ./shared
COPY data/processed ./data/processed
# Starting accounts (hashed one-time passwords), used only when the database has no users.
COPY deploy/initial-users.json ./deploy/initial-users.json
COPY --from=web /app/web/dist ./web/dist
RUN mkdir -p /var/lib/ugd && chown node:node /var/lib/ugd
USER node
VOLUME /var/lib/ugd
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "server/src/index.js"]
