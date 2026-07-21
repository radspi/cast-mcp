import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Effect, type ManagedRuntime } from "effect";
import { z } from "zod";
import { CastClient } from "../../domain/CastClient.ts";
import type { CastError } from "../../domain/errors.ts";
import { createTool } from "../../tools/types.ts";
import { runTool } from "../utils.ts";

export const getVolumeTool = createTool({
  name: "get_volume",
  description: "Get the current volume level (0.0–1.0) and mute state of a Cast device.",
  category: "volume",
  parameters: {
    host: z.string().describe("IP address or hostname of the Cast device"),
  },
  annotations: {
    title: "Get Volume",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  execute: ({ host }) =>
    Effect.gen(function* () {
      const client = yield* CastClient;
      return yield* client.getVolume(host);
    }),
});

export const setVolumeTool = createTool({
  name: "set_volume",
  description:
    "Set the volume level of a Cast device. Level must be between 0.0 (silent) and 1.0 (maximum).",
  category: "volume",
  parameters: {
    host: z.string().describe("IP address or hostname of the Cast device"),
    level: z.number().min(0).max(1).describe("Volume level between 0.0 and 1.0"),
  },
  annotations: {
    title: "Set Volume",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  execute: ({ host, level }) =>
    Effect.gen(function* () {
      const client = yield* CastClient;
      yield* client.setVolume(host, level);
      return { ok: true, level };
    }),
});

export const muteTool = createTool({
  name: "mute",
  description: "Mute a Cast device.",
  category: "volume",
  parameters: {
    host: z.string().describe("IP address or hostname of the Cast device"),
  },
  annotations: {
    title: "Mute Device",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  execute: ({ host }) =>
    Effect.gen(function* () {
      const client = yield* CastClient;
      yield* client.setMuted(host, true);
      return { ok: true, muted: true };
    }),
});

export const unmuteTool = createTool({
  name: "unmute",
  description: "Unmute a Cast device.",
  category: "volume",
  parameters: {
    host: z.string().describe("IP address or hostname of the Cast device"),
  },
  annotations: {
    title: "Unmute Device",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  execute: ({ host }) =>
    Effect.gen(function* () {
      const client = yield* CastClient;
      yield* client.setMuted(host, false);
      return { ok: true, muted: false };
    }),
});

export const volumeTools = [getVolumeTool, setVolumeTool, muteTool, unmuteTool];

export const registerVolumeTools = (
  server: McpServer,
  runtime: ManagedRuntime.ManagedRuntime<CastClient, CastError>,
) => {
  for (const tool of volumeTools) {
    server.tool(
      tool.name,
      tool.description,
      tool.parameters,
      tool.annotations,
      (params: Record<string, unknown>) => runTool(runtime, tool.execute(params)),
    );
  }
};
