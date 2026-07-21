#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ManagedRuntime } from "effect";
import { CastClientLive } from "./infra/CastClientLive.ts";
import { createMcpServer } from "./mcp/server.ts";
import { startRestServer } from "./rest/server.ts";

const runtime = ManagedRuntime.make(CastClientLive);

const args = process.argv.slice(2);
const restFlagIndex = args.findIndex((arg) => arg === "--rest" || arg === "--http");
const portArg =
  restFlagIndex !== -1 && args[restFlagIndex + 1] && !args[restFlagIndex + 1].startsWith("-")
    ? args[restFlagIndex + 1]
    : undefined;
const portEnv = process.env.REST_PORT || process.env.PORT;
const port = portArg ? parseInt(portArg, 10) : portEnv ? parseInt(portEnv, 10) : undefined;

if (restFlagIndex !== -1 || portEnv !== undefined) {
  const listenPort = port && !Number.isNaN(port) ? port : 3334;
  const restServer = startRestServer(runtime, { port: listenPort });
  console.error(`[REST] Server listening on http://localhost:${restServer.port}`);
  console.error(
    `[REST] OpenAPI Spec available at http://localhost:${restServer.port}/openapi.json`,
  );
  console.error(
    `[REST] Interactive API docs available at http://localhost:${restServer.port}/docs`,
  );
}

const server = createMcpServer(runtime);
const transport = new StdioServerTransport();

await server.connect(transport);

const shutdown = async () => {
  await runtime.runPromise(runtime.disposeEffect);
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
