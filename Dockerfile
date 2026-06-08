# Build and Run Environment
FROM node:20-alpine

WORKDIR /app

# Copy package configurations
COPY package*.json tsconfig.json vite.config.ts server.ts ./
COPY shared ./shared
COPY server ./server
COPY src ./src
COPY public ./public
COPY index.html ./

# Install dependencies
RUN npm ci

# Build frontend production bundle
RUN npm run build

# Expose port (Render/Railway will automatically bind to PORT environment variable)
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Start server
CMD ["npx", "tsx", "server.ts"]
