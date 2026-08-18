import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TFlexApiClient, loadConfig } from "./tflex-api.js";

export const SERVER_NAME = "t-flex-cad-17-mcp";
export const SERVER_VERSION = "1.0.0";

const readOnlyAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
});

function serialize(value, maxCharacters) {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= maxCharacters) return text;
  return `${text.slice(0, Math.max(0, maxCharacters - 120))}\n\n[Output truncated by MCP_MAX_TOOL_OUTPUT_CHARS; narrow the query or reduce limit.]`;
}

function success(value, maxCharacters) {
  return {
    content: [{ type: "text", text: serialize(value, maxCharacters) }]
  };
}

function failure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: message }]
  };
}

function wrap(handler, maxCharacters) {
  return async input => {
    try {
      return success(await handler(input), maxCharacters);
    } catch (error) {
      return failure(error);
    }
  };
}

export function createMcpServer(options = {}) {
  const config = options.config || loadConfig(options.env);
  const api = options.apiClient || new TFlexApiClient({ config });
  const maxCharacters = options.maxToolOutputChars || config.maxToolOutputChars;

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    title: "T-FLEX CAD 17 MCP",
    websiteUrl: "https://github.com/KrickmanC/T-FLEX-CAD-17-MCP"
  });

  server.registerTool(
    "tflex_manifest",
    {
      title: "T-FLEX knowledge manifest",
      description: "Read the canonical T-FLEX CAD 17 dataset manifest and graph manifest.",
      inputSchema: {},
      annotations: readOnlyAnnotations
    },
    wrap(async () => ({
      api_base_url: api.baseUrl.href,
      manifest: await api.manifest(),
      graph_manifest: await api.graphManifest()
    }), maxCharacters)
  );

  server.registerTool(
    "tflex_search_symbols",
    {
      title: "Search T-FLEX API symbols",
      description: "Search types, methods, properties, fields, events and other symbols in llm/symbols.jsonl.",
      inputSchema: {
        query: z.string().min(2).describe("Symbol name, qualified name, signature, identifier or relevant text"),
        limit: z.number().int().min(1).max(50).default(10).describe("Maximum number of results"),
        assembly: z.string().min(1).optional().describe("Optional assembly filter"),
        kind: z.string().min(1).optional().describe("Optional symbol kind/category filter")
      },
      annotations: readOnlyAnnotations
    },
    wrap(input => api.searchSymbols(input.query, input), maxCharacters)
  );

  server.registerTool(
    "tflex_get_symbol",
    {
      title: "Get a T-FLEX API symbol",
      description: "Resolve an exact symbol identifier, qualified name, signature or name; falls back to the closest search result.",
      inputSchema: {
        identifier: z.string().min(2).describe("Exact symbol identifier, qualified name, signature or name")
      },
      annotations: readOnlyAnnotations
    },
    wrap(input => api.getSymbol(input.identifier), maxCharacters)
  );

  server.registerTool(
    "tflex_search_docs",
    {
      title: "Search T-FLEX help topics",
      description: "Search the normalized CHM/help topic index in llm/chm_pages.jsonl.",
      inputSchema: {
        query: z.string().min(2).describe("Documentation topic, command, concept or phrase"),
        limit: z.number().int().min(1).max(50).default(10).describe("Maximum number of results")
      },
      annotations: readOnlyAnnotations
    },
    wrap(input => api.searchDocs(input.query, input), maxCharacters)
  );

  server.registerTool(
    "tflex_search_capabilities",
    {
      title: "Search T-FLEX capability map",
      description: "Search the curated capability seed used to map user intents to API members and help topics.",
      inputSchema: {
        query: z.string().min(2).describe("Capability or task, for example document lifecycle, geometry or BOM"),
        limit: z.number().int().min(1).max(50).default(10).describe("Maximum number of results")
      },
      annotations: readOnlyAnnotations
    },
    wrap(input => api.searchCapabilities(input.query, input), maxCharacters)
  );

  server.registerTool(
    "tflex_get_document",
    {
      title: "Read a T-FLEX documentation artifact",
      description: "Read an allowlisted Markdown, CHM mirror, XML API, graph or manifest file by repository-relative path.",
      inputSchema: {
        relative_path: z.string().min(1).describe("Path below the T-FLEX-CAD-17-API Pages base URL")
      },
      annotations: readOnlyAnnotations
    },
    wrap(input => api.getDocument(input.relative_path), maxCharacters)
  );

  return server;
}
