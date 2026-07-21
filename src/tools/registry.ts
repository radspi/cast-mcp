import { appTools } from "../mcp/tools/apps.ts";
import { discoveryTools } from "../mcp/tools/discovery.ts";
import { mediaTools } from "../mcp/tools/media.ts";
import { queueTools } from "../mcp/tools/queue.ts";
import { volumeTools } from "../mcp/tools/volume.ts";
import type { ToolDefinition } from "./types.ts";

export const allTools: ToolDefinition[] = [
  ...discoveryTools,
  ...appTools,
  ...mediaTools,
  ...queueTools,
  ...volumeTools,
];

export const getToolByName = (name: string): ToolDefinition | undefined =>
  allTools.find((t) => t.name === name);

export const getToolsByCategory = (category: string): ToolDefinition[] =>
  allTools.filter((t) => t.category === category);
