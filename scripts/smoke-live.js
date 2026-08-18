import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const RUNTIME_BASE = "https://t-flex-cad-17-mcp.onrender.com";

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function toolText(result) {
  return (result.content || []).filter(item => item.type === "text").map(item => item.text).join("\n");
}

function parseTool(result) {
  const text = toolText(result);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function call(client, name, args, timeout = 120_000) {
  const result = await withTimeout(client.callTool({ name, arguments: args }), timeout, name);
  assert.equal(result.isError, undefined, `${name} returned an MCP error: ${toolText(result)}`);
  return parseTool(result);
}

const transport = new StreamableHTTPClientTransport(new URL(`${RUNTIME_BASE}/mcp`));
const client = new Client({ name: "document-creation-query", version: "1.0.0" });

let output;
try {
  await withTimeout(client.connect(transport), 90_000, "MCP initialize");

  const [createDocument, newDocument, documents, docsRu, docsEn, capabilities] = await Promise.all([
    call(client, "tflex_search_symbols", { query: "CreateDocument", limit: 8 }),
    call(client, "tflex_search_symbols", { query: "NewDocument", limit: 8 }),
    call(client, "tflex_search_symbols", { query: "Documents", limit: 10 }),
    call(client, "tflex_search_docs", { query: "создание нового документа", limit: 8 }),
    call(client, "tflex_search_docs", { query: "create new document", limit: 8 }),
    call(client, "tflex_search_capabilities", { query: "документ", limit: 8 })
  ]);

  output = {
    status: "ok",
    runtime: RUNTIME_BASE,
    request: "code/API for creating a new T-FLEX CAD document",
    response: {
      search_symbols_CreateDocument: createDocument,
      search_symbols_NewDocument: newDocument,
      search_symbols_Documents: documents,
      search_docs_ru: docsRu,
      search_docs_en: docsEn,
      search_capabilities_document: capabilities
    }
  };
} finally {
  await client.close().catch(() => {});
}

console.log("=== MCP DOCUMENT CREATION QUERY ===");
console.log(JSON.stringify(output, null, 2));
