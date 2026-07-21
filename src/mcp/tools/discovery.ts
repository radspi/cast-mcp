import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Effect, type ManagedRuntime } from "effect";
import { z } from "zod";
import { CastClient } from "../../domain/CastClient.ts";
import type { CastError } from "../../domain/errors.ts";
import { createTool } from "../../tools/types.ts";
import { runTool } from "../utils.ts";

export const discoverDevicesTool = createTool({
  name: "discover_devices",
  description:
    "Scan the local network for Cast-enabled devices (Google Home, Chromecast, Nest Audio, etc.). Returns a list of devices with their name, host, port, type (audio/video/group), and model.",
  category: "discovery",
  parameters: {
    timeoutMs: z
      .number()
      .optional()
      .describe("How long to listen for mDNS responses in milliseconds (default: 5000)"),
  },
  annotations: {
    title: "Discover Cast Devices",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  execute: ({ timeoutMs }) =>
    Effect.gen(function* () {
      const client = yield* CastClient;
      return yield* client.discoverDevices(timeoutMs);
    }),
});

export const discoveryTools = [discoverDevicesTool];

export const registerDiscoveryTools = (
  server: McpServer,
  runtime: ManagedRuntime.ManagedRuntime<CastClient, CastError>,
) => {
  for (const tool of discoveryTools) {
    server.tool(
      tool.name,
      tool.description,
      tool.parameters,
      tool.annotations,
      (params: Record<string, unknown>) => runTool(runtime, tool.execute(params)),
    );
  }
};
