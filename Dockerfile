# Build Stage for Frontend
FROM node:18-alpine as frontend-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# Production Stage
FROM node:18-alpine
WORKDIR /app

# Install Backend Deps
COPY server/package*.json ./server/
WORKDIR /app/server
RUN apk add --no-cache python3 make g++
RUN npm install --production

# Copy Backend Code
COPY server/ ./

# Copy Built Frontend from Stage 1 to a accessible location
# We mimic the structure: /app/server and /app/web/dist
COPY --from=frontend-build /app/web/dist ../web/dist

# Environment Variables
ENV PORT=3000
ENV NODE_ENV=production
ENV STORAGE_PATH=/data

# Create Volume mount point
VOLUME ["/data"]

# Start
EXPOSE 3000
CMD ["node", "index.js"]
