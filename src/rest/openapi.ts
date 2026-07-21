import { z } from "zod";
import { allTools } from "../tools/registry.ts";

export function zodToOpenApiSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def;
  const description = schema.description || def.description;

  let result: Record<string, unknown> = {};
  const typeName = def.typeName;

  if (typeName === z.ZodFirstPartyTypeKind.ZodOptional || typeName === "ZodOptional") {
    result = zodToOpenApiSchema(def.innerType);
  } else if (typeName === z.ZodFirstPartyTypeKind.ZodString || typeName === "ZodString") {
    result = { type: "string" };
  } else if (typeName === z.ZodFirstPartyTypeKind.ZodNumber || typeName === "ZodNumber") {
    result = { type: "number" };
    if (Array.isArray(def.checks)) {
      for (const check of def.checks) {
        if (check.kind === "min") result.minimum = check.value;
        if (check.kind === "max") result.maximum = check.value;
      }
    }
  } else if (typeName === z.ZodFirstPartyTypeKind.ZodBoolean || typeName === "ZodBoolean") {
    result = { type: "boolean" };
  } else if (typeName === z.ZodFirstPartyTypeKind.ZodArray || typeName === "ZodArray") {
    result = {
      type: "array",
      items: zodToOpenApiSchema(def.type),
    };
    if (Array.isArray(def.checks)) {
      for (const check of def.checks) {
        if (check.kind === "min") result.minItems = check.value;
        if (check.kind === "max") result.maxItems = check.value;
      }
    }
  } else if (typeName === z.ZodFirstPartyTypeKind.ZodObject || typeName === "ZodObject") {
    const shape = def.shape();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, propSchema] of Object.entries(shape)) {
      const prop = propSchema as z.ZodTypeAny;
      properties[key] = zodToOpenApiSchema(prop);
      if (
        prop._def.typeName !== z.ZodFirstPartyTypeKind.ZodOptional &&
        prop._def.typeName !== "ZodOptional"
      ) {
        required.push(key);
      }
    }

    result = {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  } else {
    result = { type: "string" };
  }

  if (description) {
    result.description = description;
  }

  return result;
}

export function generateOpenApiSpec(version = "1.1.4"): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const tool of allTools) {
    const pathKey = `/api/tools/${tool.name}`;
    const toolSchema = zodToOpenApiSchema(tool.schema) as {
      properties?: Record<string, Record<string, unknown>>;
      required?: string[];
    };
    const isReadOnly = tool.annotations.readOnlyHint;

    const operationBase = {
      tags: [tool.category],
      summary: tool.annotations.title,
      description: tool.description,
      operationId: tool.name,
      responses: {
        "200": {
          description: `Successful execution of ${tool.annotations.title}`,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean", example: true },
                  tool: { type: "string", example: tool.name },
                  result: { type: "object", description: "Result returned by tool" },
                },
                required: ["ok", "tool", "result"],
              },
            },
          },
        },
        "400": {
          description: "Validation error or invalid request parameters",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean", example: false },
                  error: { type: "string" },
                  details: { type: "array", items: { type: "object" } },
                },
                required: ["ok", "error"],
              },
            },
          },
        },
        "500": {
          description: "Tool execution failure",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean", example: false },
                  error: { type: "string" },
                },
                required: ["ok", "error"],
              },
            },
          },
        },
      },
    };

    const pathItem: Record<string, unknown> = {};

    // POST endpoint for all tools
    const postOperation: Record<string, unknown> = {
      ...operationBase,
      requestBody: {
        required: (toolSchema.required?.length ?? 0) > 0,
        content: {
          "application/json": {
            schema: toolSchema,
          },
        },
      },
    };
    pathItem.post = postOperation;

    // GET endpoint if read-only or no required array parameters
    if (isReadOnly) {
      const queryParameters: Record<string, unknown>[] = [];
      const properties = toolSchema.properties ?? {};
      const requiredList = toolSchema.required ?? [];

      for (const [propName, propDef] of Object.entries(properties)) {
        queryParameters.push({
          name: propName,
          in: "query",
          required: requiredList.includes(propName),
          description: (propDef.description as string) || propName,
          schema: propDef,
        });
      }

      pathItem.get = {
        ...operationBase,
        parameters: queryParameters,
      };
    }

    paths[pathKey] = pathItem;
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "Google Cast MCP REST API",
      version,
      description:
        "Native REST API & OpenAPI specification for Google Cast MCP server tools. Enables direct HTTP invocation and integration with REST clients, OpenAPI generators, and web applications.",
      contact: {
        name: "Google Cast MCP",
        url: "https://github.com/daanrongen/cast-mcp",
      },
    },
    tags: [
      { name: "discovery", description: "Discover Cast-enabled devices on the local network" },
      { name: "apps", description: "Control receiver applications and query device status" },
      { name: "media", description: "Playback control, media seeking, and playback status" },
      { name: "queue", description: "Playlist queue loading and navigation" },
      { name: "volume", description: "Device volume levels and mute control" },
    ],
    paths,
  };
}
