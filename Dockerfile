# ═════════════════════════════════════════════
# STAGE 1: Build the backend (Node/Express)
# ═════════════════════════════════════════════
FROM node:22-alpine AS backend-build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install
COPY server/ ./
RUN npm run build

# ═════════════════════════════════════════════
# STAGE 2: Build the frontend (React/Vite)
# ═════════════════════════════════════════════
FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

# We pass an empty string because the backend is now hosting the frontend itself
# relative /api/ endpoints will connect seamlessly to the same exact origin URL automatically.
ARG VITE_MCP_SERVER_URL=""
ENV VITE_MCP_SERVER_URL=$VITE_MCP_SERVER_URL

RUN npm run build

# ═════════════════════════════════════════════
# STAGE 3: Production Monolithic Image
# ═════════════════════════════════════════════
FROM node:22-alpine
WORKDIR /app

# 1. Pull the Backend distribution and its production packages only
COPY --from=backend-build /app/server/dist ./server/dist
COPY --from=backend-build /app/server/package*.json ./server/
WORKDIR /app/server
RUN npm install --production

# 2. Pull the compiled static Frontend Dashboard
WORKDIR /app
COPY --from=frontend-build /app/dist ./dist

# 3. Expose the unified port cleanly
EXPOSE 3001
ENV PORT=3001

# Cloud Run boots via the WORKDIR /app/server directory automatically since we cd into it.
WORKDIR /app/server
CMD ["npm", "start"]
