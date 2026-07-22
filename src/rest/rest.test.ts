import { describe, expect, it } from "bun:test";
import { ManagedRuntime } from "effect";
import { CastClientTest } from "../infra/CastClientTest.ts";
import { allTools } from "../tools/registry.ts";
import { generateOpenApiSpec } from "./openapi.ts";
import { createRestHandler } from "./server.ts";

describe("OpenAPI Specification", () => {
  it("generates a valid OpenAPI 3.0.3 specification", () => {
    const spec = generateOpenApiSpec();
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info).toBeDefined();
    expect((spec.info as { title: string }).title).toContain("Google Cast MCP REST API");
  });

  it("includes paths for all 17 registered tools", () => {
    const spec = generateOpenApiSpec();
    const paths = spec.paths as Record<string, unknown>;

    expect(allTools.length).toBe(17);
    expect(Object.keys(paths).length).toBe(17);

    for (const tool of allTools) {
      expect(paths[`/api/tools/${tool.name}`]).toBeDefined();
    }
  });

  it("includes correct OpenAPI tags", () => {
    const spec = generateOpenApiSpec();
    const tags = (spec.tags as Array<{ name: string }>).map((t) => t.name);
    expect(tags).toEqual(["discovery", "apps", "media", "queue", "volume"]);
  });
});

describe("REST API HTTP Server", () => {
  const runtime = ManagedRuntime.make(CastClientTest);
  const handler = createRestHandler(runtime);

  it("GET /openapi.json returns OpenAPI specification JSON", async () => {
    const req = new Request("http://localhost/openapi.json");
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const json = (await res.json()) as { openapi: string };
    expect(json.openapi).toBe("3.0.3");
  });

  it("GET /docs returns interactive Swagger UI HTML page", async () => {
    const req = new Request("http://localhost/docs");
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html");
    const html = await res.text();
    expect(html).toContain("SwaggerUIBundle");
    expect(html).toContain("/openapi.json");
  });

  it("GET /health returns a healthy status payload", async () => {
    const req = new Request("http://localhost/health");
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = (await res.json()) as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ok");
  });

  it("GET /api/tools lists all 17 registered tools with metadata", async () => {
    const req = new Request("http://localhost/api/tools");
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tools: Array<{ name: string }> };
    expect(body.ok).toBe(true);
    expect(body.tools.length).toBe(17);
  });

  it("GET /api/tools/discover_devices invokes discovery tool", async () => {
    const req = new Request("http://localhost/api/tools/discover_devices?timeoutMs=1000");
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tool: string; result: Array<unknown> };
    expect(body.ok).toBe(true);
    expect(body.tool).toBe("discover_devices");
    expect(Array.isArray(body.result)).toBe(true);
    expect(body.result.length).toBe(2);
  });

  it("POST /api/tools/play_media executes play_media tool", async () => {
    const req = new Request("http://localhost/api/tools/play_media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: "192.168.1.50",
        contentUrl: "http://example.com/audio.mp3",
        contentType: "audio/mp3",
        title: "Test Track",
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result: { playerState: string } };
    expect(body.ok).toBe(true);
    expect(body.result.playerState).toBe("PLAYING");
  });

  it("POST /api/tools/play_media handles back-to-back calls without hanging", async () => {
    const payload = {
      host: "192.168.1.50",
      contentUrl: "http://example.com/audio.mp3",
      contentType: "audio/mp3",
    };

    const first = await handler(
      new Request("http://localhost/api/tools/play_media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    const second = await handler(
      new Request("http://localhost/api/tools/play_media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          contentUrl: "http://example.com/other.mp3",
        }),
      }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as { ok: boolean; result: { playerState: string } };
    const secondBody = (await second.json()) as { ok: boolean; result: { playerState: string } };
    expect(firstBody.ok).toBe(true);
    expect(secondBody.ok).toBe(true);
    expect(firstBody.result.playerState).toBe("PLAYING");
    expect(secondBody.result.playerState).toBe("PLAYING");
  });

  it("POST /api/tools/set_volume executes set_volume tool", async () => {
    const req = new Request("http://localhost/api/tools/set_volume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: "192.168.1.50",
        level: 0.8,
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result: { ok: boolean; level: number } };
    expect(body.ok).toBe(true);
    expect(body.result.level).toBe(0.8);
  });

  it("POST /api/tools/set_volume returns 400 Bad Request for invalid volume level", async () => {
    const req = new Request("http://localhost/api/tools/set_volume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: "192.168.1.50",
        level: 1.5, // > 1.0 maximum
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Validation error");
  });

  it("POST /api/tools/non_existent_tool returns 404 Not Found", async () => {
    const req = new Request("http://localhost/api/tools/non_existent_tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("not found");
  });
});
