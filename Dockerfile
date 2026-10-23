# BoxBim — imagem para servidor (VPS / Easypanel). Ver DEPLOY.md.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: nenhuma dependência precisa de script de instalação (o esbuild usa o binário do pacote da plataforma)
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORTA=3000 \
    HOST=0.0.0.0 \
    BOXBIM_DATA=/data \
    BOXBIM_PROXY=1 \
    BOXBIM_REMOTO=1
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORTA||3000)+'/api/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
