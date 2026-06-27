# Code Graph live demo — single image that builds the workspace and serves both
# the API/WebSocket server and the built web app from one origin.
#
# `git` is installed in the runtime layer because the server clones public repos
# on demand (paste-a-URL). ts-morph indexing is CPU/RAM heavy, so run this on an
# instance with >=1GB RAM (2GB recommended); on a 512MB plan set
# INDEX_WORKER_HEAP_MB=420 to keep the index worker under the cap.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
# Workspace manifests first for a cached install layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json .npmrc ./
COPY packages ./packages
COPY tools ./tools
COPY apps ./apps
RUN pnpm install --frozen-lockfile
# Build shared packages, the code-indexer engine, and the web app (dist/).
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# git: required for clone-on-demand. Then drop apt lists to keep the image lean.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY --from=build /app ./
# Serve the built web app from the same origin as the API + WS.
ENV WEB_DIST=/app/apps/web/code-graph/dist
# Default listen port. Render/Heroku inject their own PORT (overrides this);
# Hugging Face Spaces proxies a fixed port (7860), which this default matches.
ENV PORT=7860
EXPOSE 7860
CMD ["pnpm", "--filter", "indexer-server", "start"]
