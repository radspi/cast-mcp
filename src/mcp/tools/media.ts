import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Effect, type ManagedRuntime } from "effect";
import { z } from "zod";
import { CastClient } from "../../domain/CastClient.ts";
import type { CastError } from "../../domain/errors.ts";
import { createTool } from "../../tools/types.ts";
import { runTool } from "../utils.ts";

export const playMediaTool = createTool({
  name: "play_media",
  description:
    "Play a media URL on a Cast device. Provide the device host (IP or hostname), a direct URL to the media, its MIME type, and optional metadata.",
  category: "media",
  parameters: {
    host: z.string().describe("IP address or hostname of the Cast device"),
    contentUrl: z.string().describe("Direct URL of the media to play"),
    contentType: z.string().describe('MIME type, e.g. "audio/mp3" or "video/mp4"'),
    title: z.string().optional().describe("Track or video title"),
    artist: z.string().optional().describe("Artist name"),
    albumName: z.string().optional().describe("Album name"),
  },
  annotations: {
    title: "Play Media",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  execute: ({ host, contentUrl, contentType, title, artist, albumName }) => {
    const metadata: Record<string, string> = {};
    if (title) metadata.title = title;
    if (artist) metadata.artist = artist;
    if (albumName) metadata.albumName = albumName;

    return Effect.gen(function* () {
      const client = yield* CastClient;
      return yield* client.playMedia(
        host,
        contentUrl,
        contentType,
        Object.keys(metadata).length > 0 ? metadata : undefined,
      );
    });
  },
});

export const pauseTool = createTool({
  name: "pause",
  description: "Pause the currently playing media on a Cast device.",
  category: "media",
  parameters: {
    host: z.string().describe("IP address or hostname of the Cast device"),
  },
  annotations: {
    title: "Pause Media",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  execute: ({ host }) =>
    Effect.gen(function* () {
      const client = yield* CastClient;
      yield* client.pauseMedia(host);
      return { ok: true };
    }),
});

export const resumeTool = createTool({
  name: "resume",
  description: "Resume paused media on a Cast device.",
  category: "media",
  parameters: {
    host: z.string().describe("IP address or hostname of the Cast device"),
  },
  annotations: {
    title: "Resume Media",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  execute: ({ host }) =>
    Effect.gen(function* () {
      const client = yield* CastClient;
      yield* client.resumeMedia(host);
      return { ok: true };
    }),
});

export const stopTool = createTool({
  name: "stop",
  description: "Stop the current media session on a Cast device.",
  category: "media",
  parameters: {
    host: z.string().describe("IP address or hostname of the Cast device"),
  },
  annotations: {
    title: "Stop Media",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  execute: ({ host }) =>
    Effect.gen(function* () {
      const client = yield* CastClient;
      yield* client.stopMedia(host);
      return { ok: true };
    }),
});

export const seekTool = createTool({
  name: "seek",
  description: "Seek to a position in the currently playing media on a Cast device.",
  category: "media",
  parameters: {
    host: z.string().describe("IP address or hostname of the Cast device"),
    currentTime: z.number().describe("Position to seek to, in seconds"),
  },
  annotations: {
    title: "Seek Media",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  execute: ({ host, currentTime }) =>
    Effect.gen(function* () {
      const client = yield* CastClient;
      yield* client.seekMedia(host, currentTime);
      return { ok: true };
    }),
});

export const getMediaStatusTool = createTool({
  name: "get_media_status",
  description:
    "Get the current media playback state on a Cast device (player state, position, duration, title, etc.).",
  category: "media",
  parameters: {
    host: z.string().describe("IP address or hostname of the Cast device"),
  },
  annotations: {
    title: "Get Media Status",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  execute: ({ host }) =>
    Effect.gen(function* () {
      const client = yield* CastClient;
      return yield* client.getMediaStatus(host);
    }),
});

export const mediaTools = [
  playMediaTool,
  pauseTool,
  resumeTool,
  stopTool,
  seekTool,
  getMediaStatusTool,
];

export const registerMediaTools = (
  server: McpServer,
  runtime: ManagedRuntime.ManagedRuntime<CastClient, CastError>,
) => {
  for (const tool of mediaTools) {
    server.tool(
      tool.name,
      tool.description,
      tool.parameters,
      tool.annotations,
      (params: Record<string, unknown>) => runTool(runtime, tool.execute(params)),
    );
  }
};
