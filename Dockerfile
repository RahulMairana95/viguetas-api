# ============================================================
#  viguetas-api — imagen de producción
#  Render la usa si agregás este archivo; Cloud Run la exige.
# ============================================================

# --- Etapa de build ---
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# --- Etapa de producción (solo dependencias de runtime) ---
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist

# Cloud Run inyecta PORT; Render usa el puerto del entorno o este por defecto.
ENV PORT=4000
EXPOSE 4000
CMD ["node", "dist/server.js"]
