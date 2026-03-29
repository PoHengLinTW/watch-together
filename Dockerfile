FROM node:22-alpine

WORKDIR /app

# Copy root package.json and lockfile
COPY package.json package-lock.json ./

# Copy workspace package.json files
COPY server/package.json server/
COPY extension/package.json extension/
COPY shared/package.json shared/

# Install dependencies
RUN npm ci

# Copy the rest of the application
COPY . .

# The WebSocket server listens on 8080 by default
EXPOSE 8080

# Start development server using the workspace command
CMD ["npm", "run", "dev", "--workspace=@watchtogether/server"]
