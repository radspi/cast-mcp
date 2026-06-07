FROM oven/bun:1-alpine

# Instalace závislostí pro objevování zařízení v síti (mDNS/avahi), pokud jsou potřeba
RUN apk add --no-cache dbus avahi-compat-libdns_sd

WORKDIR /app

# Spuštění MCP serveru přímo přes npx
ENTRYPOINT ["bunx", "-y", "@daanrongen/cast-mcp"]