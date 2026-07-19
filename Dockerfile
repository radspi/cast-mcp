FROM oven/bun:1-alpine

# 1. Instalace systémových závislostí pro mDNS a Python (pro mcpo)
RUN apk add --no-cache dbus avahi-compat-libdns_sd python3 py3-pip

# 2. Vytvoření virtuálního prostředí a instalace mcpo proxy
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir mcpo

WORKDIR /app

# Exponujeme port, na kterém bude poslouchat Open WebUI bridge
EXPOSE 8000

# 3. Spuštění mcpo, které lokálně (uvnitř kontejneru) zavolá bunx cast-mcp přes stdio
ENTRYPOINT ["/opt/venv/bin/mcpo", "--host", "0.0.0.0", "--port", "8000", "--api-key", "mYQmWl5oGtkchLsYmLZsvmbA4Q0f26mr", "--", "bunx", "-y", "@daanrongen/cast-mcp"]
