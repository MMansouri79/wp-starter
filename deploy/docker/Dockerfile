ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts && npm run build

FROM build AS verification
ARG ALPINE_MIRROR=https://dl-cdn.alpinelinux.org/alpine
RUN sed -i "s|https://dl-cdn.alpinelinux.org/alpine|${ALPINE_MIRROR}|g" /etc/apk/repositories \
    && apk add --no-cache php84 bash coreutils tar gzip
RUN ln -s /usr/bin/php84 /usr/local/bin/php
CMD ["npm", "run", "check"]

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/gui/package.json apps/gui/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/builder-core/package.json packages/builder-core/package.json
RUN npm ci --omit=dev --ignore-scripts

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/client ./apps/server/client
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/cli/dist ./apps/cli/dist
COPY --from=build /app/apps/cli/package.json ./apps/cli/package.json
COPY --from=build /app/packages/builder-core/dist ./packages/builder-core/dist
COPY --from=build /app/packages/builder-core/package.json ./packages/builder-core/package.json
COPY --from=build /app/apps/gui/public ./apps/gui/public
COPY --from=build /app/wordpress/bootstrap ./wordpress/bootstrap
COPY --from=build /app/profiles ./profiles
COPY --from=build /app/compatibility ./compatibility
USER node
EXPOSE 47900
CMD ["node", "apps/server/dist/index.js"]
