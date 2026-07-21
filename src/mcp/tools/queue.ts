import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Effect, type ManagedRuntime } from "effect";
import { z } from "zod";
import { CastClient } from "../../domain/CastClient.ts";
import type { CastError } from "../../domain/errors.ts";
import { QueueItem } from "../../domain/models.ts";
import { createTool } from "../../tools/types.ts";
import { runTool } from "../utils.ts";

export const loadQueueTool = createTool({
  name: "load_queue",
  description: "Load a playlist of media items onto a Cast device. Items play in order.",
  category: "queue",
  parameters: {
    host: z.string().describe("IP address or hostname of the Cast device"),
    items: z
      .array(
        z.object({
          itemId: z.number().describe("Unique integer ID for this queue item"),
          contentId: z.string().describe("Direct URL of the media"),
          contentType: z.string().describe('MIME type, e.g. "audio/mp3"'),
          title: z.string().optional().describe("Track title"),
          artist: z.string().optional().describe("Artist name"),
        }),
      )
      .min(1)
      .describe("Array of media items to load into the queue"),
  },
  annotations: {
    title: "Load Queue",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  execute: ({ host, items }) => {
    const queueItems = items.map(
      (item) =>
        new QueueItem({
          itemId: item.itemId,
          media: {
            contentId: item.contentId,
            contentType: item.contentType,
            metadata:
              item.title || item.artist ? { title: item.title, artist: item.artist } : undefined,
          },
        }),
    );

    return Effect.gen(function* () {
      const client = yield* CastClient;
      yield* client.loadQueue(host, queueItems);
      return { ok: true, itemCount: items.length };
    });
  },
});

export const queueNextTool = createTool({
  name: "queue_next",
  description: "Skip to the next item in the queue on a Cast device.",
  category: "queue",
  parameters: {
    host: z.string().describe("IP address or hostname of the Cast device"),
  },
  annotations: {
    title: "Queue Next",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  execute: ({ host }) =>
    Effect.gen(function* () {
      const client = yield* CastClient;
      yield* client.queueNext(host);
      return { ok: true };
    }),
});

export const queuePrevTool = createTool({
  name: "queue_prev",
  description: "Go to the previous item in the queue on a Cast device.",
  category: "queue",
  parameters: {
    host: z.string().describe("IP address or hostname of the Cast device"),
  },
  annotations: {
    title: "Queue Previous",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  execute: ({ host }) =>
    Effect.gen(function* () {
      const client = yield* CastClient;
      yield* client.queuePrev(host);
      return { ok: true };
    }),
});

export const queueTools = [loadQueueTool, queueNextTool, queuePrevTool];

export const registerQueueTools = (
  server: McpServer,
  runtime: ManagedRuntime.ManagedRuntime<CastClient, CastError>,
) => {
  for (const tool of queueTools) {
    server.tool(
      tool.name,
      tool.description,
      tool.parameters,
      tool.annotations,
      (params: Record<string, unknown>) => runTool(runtime, tool.execute(params)),
    );
  }
};
