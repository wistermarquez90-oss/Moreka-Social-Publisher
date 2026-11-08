FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build && npm run worker:build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-worker ./dist-worker
COPY --from=build /app/scripts/apply-content-migration.mjs ./scripts/apply-content-migration.mjs
COPY --from=build /app/scripts/apply-publishing-migration.mjs ./scripts/apply-publishing-migration.mjs
EXPOSE 3000
CMD ["npm", "start"]
