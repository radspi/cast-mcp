FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source files
COPY . .

# Expose default REST API port
EXPOSE 3334

ENV REST_PORT=3334

CMD ["bun", "run", "src/main.ts", "--rest", "3334"]
