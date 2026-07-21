import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ManagedRuntime } from "effect";
import type { CastClient } from "../domain/CastClient.ts";
import type { CastError } from "../domain/errors.ts";
import { allTools } from "../tools/registry.ts";
import { runTool } from "./utils.ts";

export const createMcpServer = (
  runtime: ManagedRuntime.ManagedRuntime<CastClient, CastError>,
): McpServer => {
  const server = new McpServer({
    name: "cast-mcp-server",
    version: "1.0.0",
  });

  for (const tool of allTools) {
    server.tool(tool.name, tool.description, tool.parameters, tool.annotations, (params) =>
      runTool(runtime, tool.execute(params)),
    );
  }

  return server;
};
