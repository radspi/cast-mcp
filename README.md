# cast-mcp

MCP server for [Google Cast](https://developers.google.com/cast) — discover devices on your local network via mDNS, play media, control volume, launch apps, and manage queues, all over stdio or native REST API with OpenAPI specification. No environment variables or API keys required; the server connects directly to Cast receivers using the castv2 protocol.

## Installation

```bash
bunx @daanrongen/cast-mcp
```

## Tools (17 total)

| Domain        | Tools                                                               | Coverage                                             |
| ------------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| **Discovery** | `discover_devices`                                                  | Scan local network for Cast-enabled devices via mDNS |
| **Media**     | `play_media`, `pause`, `resume`, `stop`, `seek`, `get_media_status` | Playback control and media status                    |
| **Queue**     | `load_queue`, `queue_next`, `queue_prev`                            | Playlist queuing and navigation                      |
| **Apps**      | `get_status`, `launch_app`, `stop_app`                              | Application lifecycle on Cast receivers              |
| **Volume**    | `get_volume`, `set_volume`, `mute`, `unmute`                        | Volume and mute control                              |

## Setup

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cast": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@daanrongen/cast-mcp"]
    }
  }
}
```

### Claude Code CLI

```bash
claude mcp add cast -- bunx @daanrongen/cast-mcp
```

## Native REST API & OpenAPI Support

All 17 tools can be invoked via native REST endpoints over HTTP, complete with OpenAPI 3.0 specification and interactive Swagger UI docs.

### Enabling REST Server

Start the server with the `--rest` flag (or `REST_PORT` / `PORT` environment variable):

```bash
bunx @daanrongen/cast-mcp --rest 3334
```

### Endpoints

- **OpenAPI Specification**: `GET http://localhost:3334/openapi.json`
- **Interactive Swagger UI**: `GET http://localhost:3334/docs`
- **Tool Catalog**: `GET http://localhost:3334/api/tools`
- **Invoke Tool**: `POST http://localhost:3334/api/tools/:toolName` (or `GET` for read-only tools)

### Example REST Call

```bash
# Play media on a Cast device via REST
curl -X POST http://localhost:3334/api/tools/play_media \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.50",
    "contentUrl": "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "contentType": "video/mp4",
    "title": "Big Buck Bunny"
  }'
```

## Running with Docker

### Docker Compose

Use `docker compose` for local container execution with host networking (required for mDNS device discovery):

```bash
docker compose up -d
```

### Docker CLI

Build and run using Docker CLI:

```bash
docker build -t cast-mcp .
docker run -d --name cast-mcp --network host cast-mcp
```

The REST API and Swagger UI will be available at `http://localhost:3334/docs`.

## Development

```bash
bun install
bun run dev        # run with --watch
bun test           # run test suite
bun run typecheck  # type check without emitting
bun run build      # bundle to dist/main.js
bun run inspect    # open MCP Inspector in browser
```

## Inspecting locally

`bun run inspect` launches the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) against the local build:

```bash
bun run build && bun run inspect
```

This opens the Inspector UI in your browser where you can call any tool interactively and inspect request/response shapes.

## Architecture

```
src/
├── config.ts                   # Config definitions (DiscoveryTimeoutConfig, RestPortConfig)
├── main.ts                     # Entry point — Stdio transport + optional REST HTTP server
├── domain/
│   ├── CastClient.ts           # Context.Tag service interface (port)
│   ├── errors.ts               # CastError, DeviceNotFoundError
│   ├── models.ts               # Schema.Class models (CastDevice, MediaStatus, …)
│   ├── discovery.test.ts       # Discovery domain tests
│   ├── media.test.ts           # Media domain tests
│   └── volume.test.ts          # Volume domain tests
├── infra/
│   ├── CastClientLive.ts       # Layer.scoped — mDNS discovery + castv2 connections
│   └── CastClientTest.ts       # In-memory test adapter
├── tools/
│   ├── types.ts                # ToolDefinition interface & createTool helper
│   └── registry.ts             # Unified allTools registry for all 17 tools
├── rest/
│   ├── openapi.ts              # OpenAPI 3.0 spec generator & Zod-to-OpenAPI schema converter
│   ├── server.ts               # REST API HTTP server handler & Swagger UI provider
│   └── rest.test.ts            # OpenAPI & REST API test suite
└── mcp/
    ├── server.ts               # McpServer wired to ManagedRuntime and Tool Registry
    ├── utils.ts                # formatSuccess, formatError
    └── tools/                  # discovery.ts, media.ts, queue.ts, apps.ts, volume.ts
```

## License

MIT
