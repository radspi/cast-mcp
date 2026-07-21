import { Cause, type ManagedRuntime } from "effect";
import type { CastClient } from "../domain/CastClient.ts";
import type { CastError } from "../domain/errors.ts";
import { allTools, getToolByName } from "../tools/registry.ts";
import { generateOpenApiSpec } from "./openapi.ts";

export interface RestServerOptions {
  port?: number;
  hostname?: string;
}

function parseQueryParams(url: URL): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (value === "true") {
      params[key] = true;
    } else if (value === "false") {
      params[key] = false;
    } else if (!Number.isNaN(Number(value)) && value.trim() !== "") {
      params[key] = Number(value);
    } else {
      params[key] = value;
    }
  }
  return params;
}

const swaggerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Google Cast MCP REST API - Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; padding: 0; background: #fafafa; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
      });
    };
  </script>
</body>
</html>`;

export function createRestHandler(runtime: ManagedRuntime.ManagedRuntime<CastClient, CastError>) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // GET /openapi.json or /api/docs/openapi.json
    if (
      method === "GET" &&
      (pathname === "/openapi.json" || pathname === "/api/docs/openapi.json")
    ) {
      return new Response(JSON.stringify(generateOpenApiSpec(), null, 2), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // GET /docs or /swagger
    if (method === "GET" && (pathname === "/docs" || pathname === "/swagger")) {
      return new Response(swaggerHtml, {
        status: 200,
        headers: { ...headers, "Content-Type": "text/html" },
      });
    }

    // GET /api/tools - list all available tools
    if (method === "GET" && pathname === "/api/tools") {
      const toolCatalog = allTools.map((t) => ({
        name: t.name,
        description: t.description,
        category: t.category,
        annotations: t.annotations,
        parameters: Object.keys(t.parameters),
        endpoint: `/api/tools/${t.name}`,
      }));
      return new Response(JSON.stringify({ ok: true, tools: toolCatalog }, null, 2), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // GET or POST /api/tools/:toolName
    const match = pathname.match(/^\/api\/tools\/([a-zA-Z0-9_-]+)$/);
    if (match) {
      const toolName = match[1];
      const tool = getToolByName(toolName);

      if (!tool) {
        return new Response(JSON.stringify({ ok: false, error: `Tool '${toolName}' not found` }), {
          status: 404,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      let rawParams: Record<string, unknown> = {};

      if (method === "GET") {
        rawParams = parseQueryParams(url);
      } else if (method === "POST") {
        try {
          const bodyText = await req.text();
          if (bodyText.trim().length > 0) {
            rawParams = JSON.parse(bodyText);
          }
        } catch (_err) {
          return new Response(
            JSON.stringify({ ok: false, error: "Invalid JSON in request body" }),
            {
              status: 400,
              headers: { ...headers, "Content-Type": "application/json" },
            },
          );
        }
      } else {
        return new Response(JSON.stringify({ ok: false, error: `Method ${method} not allowed` }), {
          status: 405,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      const parseResult = tool.schema.safeParse(rawParams);
      if (!parseResult.success) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: `Validation error: ${parseResult.error.issues[0]?.message || "Invalid parameters"}`,
            details: parseResult.error.issues,
          }),
          {
            status: 400,
            headers: { ...headers, "Content-Type": "application/json" },
          },
        );
      }

      const exit = await runtime.runPromiseExit(tool.execute(parseResult.data));

      if (exit._tag === "Failure") {
        const errorMessage = Cause.pretty(exit.cause);
        const isNotFound = errorMessage.includes("DeviceNotFoundError");
        return new Response(
          JSON.stringify({
            ok: false,
            error: errorMessage,
          }),
          {
            status: isNotFound ? 404 : 500,
            headers: { ...headers, "Content-Type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          tool: tool.name,
          result: exit.value,
        }),
        {
          status: 200,
          headers: { ...headers, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ ok: false, error: "Endpoint not found" }), {
      status: 404,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  };
}

export function startRestServer(
  runtime: ManagedRuntime.ManagedRuntime<CastClient, CastError>,
  options: RestServerOptions = {},
) {
  const port = options.port ?? 3334;
  const hostname = options.hostname ?? "0.0.0.0";
  const fetchHandler = createRestHandler(runtime);

  const server = Bun.serve({
    port,
    hostname,
    fetch: fetchHandler,
  });

  return server;
}
