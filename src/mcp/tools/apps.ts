import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Effect, type ManagedRuntime } from "effect";
import { z } from "zod";
import { CastClient } from "../../domain/CastClient.ts";
import type { CastError } from "../../domain/errors.ts";
import { createTool } from "../../tools/types.ts";
import { runTool } from "../utils.ts";

export const getStatusTool = createTool({
  name: "get_status",
  description:
    "Get the receiver status of a Cast device: active application, volume, session info.",
  category: "apps",
  parameters: {
    host: z.string().describe("IP address or hostname of the Cast device"),
  },
  annotations: {
    title: "Get Receiver Status",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  execute: ({ host }) =>
    Effect.gen(function* () {
      const client = yield* CastClient;
      return yield* client.getStatus(host);
    }),
});

export const launchAppTool = createTool({
  name: "launch_app",
  description:
    'Launch an app on a Cast device by its appId. Common app IDs: "CC1AD845" (Default Media Receiver), "YouTube" (YouTube), "233637DE" (Google Play Music).',
  category: "apps",
  parameters: {
    host: z.string().describe("IP address or hostname of the Cast device"),
    appId: z
      .string()
      .describe('Cast app ID, e.g. "CC1AD845" for Default Media Receiver or "YouTube"'),
  },
  annotations: {
    title: "Launch App",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  execute: ({ host, appId }) =>
    Effect.gen(function* () {
      const client = yield* CastClient;
      return yield* client.launchApp(host, appId);
    }),
});

export const stopAppTool = createTool({
  name: "stop_app",
  description: "Stop the currently running app on a Cast device.",
  category: "apps",
  parameters: {
    host: z.string().describe("IP address or hostname of the Cast device"),
  },
  annotations: {
    title: "Stop App",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  execute: ({ host }) =>
    Effect.gen(function* () {
      const client = yield* CastClient;
      yield* client.stopApp(host);
      return { ok: true };
    }),
});

export const appTools = [getStatusTool, launchAppTool, stopAppTool];

export const registerAppTools = (
  server: McpServer,
  runtime: ManagedRuntime.ManagedRuntime<CastClient, CastError>,
) => {
  for (const tool of appTools) {
    server.tool(
      tool.name,
      tool.description,
      tool.parameters,
      tool.annotations,
      (params: Record<string, unknown>) => runTool(runtime, tool.execute(params)),
    );
  }
};
