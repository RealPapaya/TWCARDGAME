FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/cards/package.json packages/cards/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/rules/package.json packages/rules/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/test-utils/package.json packages/test-utils/package.json
RUN npm ci

FROM deps AS build
COPY tsconfig*.json ./
COPY LEGACY/assets LEGACY/assets
COPY apps apps
COPY packages packages
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/packages packages
COPY package.json package-lock.json ./
CMD ["node", "apps/server/dist/index.js"]
