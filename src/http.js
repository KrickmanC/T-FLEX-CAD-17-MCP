import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { TFlexApiClient, loadConfig } from "./tflex-api.js";

function jsonRpcError(res, status, code, message) {
  if (res.headersSent) return;
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null
  });
}

function originAllowed(origin, allowedOrigins) {
  return !origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}

export function createHttpRuntime(options = {}) {
  const config = options.config || loadConfig(options.env);
  const apiClient = options.apiClient || new TFlexApiClient({ config });
  const logger = options.logger || console;
  const app = express();
  const sessions = new Map();

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!originAllowed(origin, config.allowedOrigins)) {
      res.status(403).json({ error: "Origin is not allowed" });
      return;
    }
    if (origin) res.setHeader("Access-Control-Allow-Origin", config.allowedOrigins.includes("*") ? "*" : origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, MCP-Session-Id, MCP-Protocol-Version, Last-Event-ID"
    );
    res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.json({
      service: SERVER_NAME,
      version: SERVER_VERSION,
      protocol: "Model Context Protocol",
      transport: "Streamable HTTP",
      mcp_endpoint: "/mcp",
      health_endpoint: "/healthz",
      readiness_endpoint: "/readyz",
      api_base_url: apiClient.baseUrl.href,
      read_only: true
    });
  });

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", service: SERVER_NAME, version: SERVER_VERSION, active_sessions: sessions.size });
  });

  app.get("/readyz", async (_req, res) => {
    try {
      const [manifest, graphManifest] = await Promise.all([apiClient.manifest(), apiClient.graphManifest()]);
      res.json({
        status: "ready",
        api_base_url: apiClient.baseUrl.href,
        dataset: manifest.dataset,
        generated_at: manifest.generated_at,
        counts: manifest.counts,
        graph_counts: graphManifest.counts
      });
    } catch (error) {
      res.status(503).json({
        status: "not_ready",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/mcp", async (req, res) => {
    const requestedSessionId = req.headers["mcp-session-id"];
    let entry = typeof requestedSessionId === "string" ? sessions.get(requestedSessionId) : undefined;

    try {
      if (!entry) {
        if (requestedSessionId || !isInitializeRequest(req.body)) {
          jsonRpcError(res, 400, -32000, "Bad Request: missing, invalid or expired MCP session");
          return;
        }

        let server;
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: sessionId => {
            sessions.set(sessionId, { server, transport });
          }
        });
        server = createMcpServer({ apiClient, config });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await server.connect(transport);
        entry = { server, transport };
      }

      await entry.transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error?.("MCP POST failed", error);
      jsonRpcError(res, 500, -32603, "Internal MCP server error");
    }
  });

  const handleEstablishedSession = async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (typeof sessionId !== "string" || !sessions.has(sessionId)) {
      jsonRpcError(res, 400, -32000, "Bad Request: missing, invalid or expired MCP session");
      return;
    }
    try {
      await sessions.get(sessionId).transport.handleRequest(req, res);
    } catch (error) {
      logger.error?.(`MCP ${req.method} failed`, error);
      jsonRpcError(res, 500, -32603, "Internal MCP server error");
    }
  };

  app.get("/mcp", handleEstablishedSession);
  app.delete("/mcp", handleEstablishedSession);

  app.use((error, _req, res, _next) => {
    logger.error?.("HTTP middleware failed", error);
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "Request body is too large" });
      return;
    }
    res.status(400).json({ error: "Invalid HTTP request" });
  });

  async function closeSessions() {
    const entries = [...sessions.values()];
    sessions.clear();
    await Promise.allSettled(entries.flatMap(({ server, transport }) => [transport.close(), server.close()]));
  }

  return { app, closeSessions, sessionCount: () => sessions.size, apiClient, config };
}

export async function startHttpServer(options = {}) {
  const runtime = createHttpRuntime(options);
  const httpServer = runtime.app.listen(runtime.config.port, runtime.config.host, () => {
    console.log(`${SERVER_NAME} ${SERVER_VERSION} listening on http://${runtime.config.host}:${runtime.config.port}/mcp`);
  });

  let stopping = false;
  const stop = async signal => {
    if (stopping) return;
    stopping = true;
    console.log(`Stopping ${SERVER_NAME} (${signal})`);
    await runtime.closeSessions();
    await new Promise(resolve => httpServer.close(resolve));
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
  return { ...runtime, httpServer, stop };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startHttpServer().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
