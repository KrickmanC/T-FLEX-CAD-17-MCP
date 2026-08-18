import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TFlexApiClient } from "../src/tflex-api.js";
import { createHttpRuntime } from "../src/http.js";

const manifest = {
  schema_version: "1.0.0",
  dataset: "T-FLEX CAD 17 fixture",
  generated_at: "2026-08-18T00:00:00Z",
  counts: { assemblies: 2, types: 3, symbols: 3, chm_pages: 2 },
  entrypoints: {
    symbol_index: "llm/symbols.jsonl",
    chm_index: "llm/chm_pages.jsonl",
    graph_manifest: "graph/manifest.json",
    capability_seed: "graph/capabilities.seed.jsonl"
  }
};
const graphManifest = { schema_version: "1.0.0", counts: { nodes: 8, edges: 12 } };
const symbols = [
  { id: "T:TFlex.Model.Document", name: "Document", full_name: "TFlex.Model.Document", assembly: "TFlex", kind: "type" },
  { id: "M:TFlex.Model.Document.Save", name: "Save", full_name: "TFlex.Model.Document.Save()", assembly: "TFlex", kind: "method", type_page: "llm/types/TFlex__Document__fixture.md" },
  { id: "M:TFlexAPI3D.Body.Create", name: "Create", full_name: "TFlexAPI3D.Body.Create()", assembly: "TFlexAPI3D", kind: "method" }
];
const docs = [
  { slug: "document-save", title: "Saving a document", summary: "Save and close a T-FLEX document.", path: "chm/document-save.md" },
  { slug: "body-create", title: "Creating a 3D body", summary: "Create solid geometry.", path: "chm/body-create.md" }
];
const capabilities = [
  { capability_id: "document_lifecycle", name: "Document lifecycle", seed_terms: ["open", "save", "close"], seed_members: ["Document.Save"] },
  { capability_id: "geometry", name: "Create and update geometry", seed_terms: ["body", "extrude"], seed_members: ["Body.Create"] }
];

let fixtureServer;
let fixtureBaseUrl;

function jsonl(records) {
  return `${records.map(record => JSON.stringify(record)).join("\n")}\n`;
}

before(async () => {
  const routes = new Map([
    ["/llm/manifest.json", ["application/json", JSON.stringify(manifest)]],
    ["/graph/manifest.json", ["application/json", JSON.stringify(graphManifest)]],
    ["/llm/symbols.jsonl", ["application/x-ndjson", jsonl(symbols)]],
    ["/llm/chm_pages.jsonl", ["application/x-ndjson", jsonl(docs)]],
    ["/graph/capabilities.seed.jsonl", ["application/x-ndjson", jsonl(capabilities)]],
    ["/llm/types/TFlex__Document__fixture.md", ["text/markdown", "# Document\n\nFixture type documentation."]]
  ]);
  fixtureServer = http.createServer((req, res) => {
    const route = routes.get(req.url);
    if (!route) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": route[0], "content-length": Buffer.byteLength(route[1]) });
    res.end(route[1]);
  });
  fixtureServer.listen(0, "127.0.0.1");
  await once(fixtureServer, "listening");
  fixtureBaseUrl = `http://127.0.0.1:${fixtureServer.address().port}/`;
});

after(async () => {
  await new Promise(resolve => fixtureServer.close(resolve));
});

test("knowledge client reads manifests, searches indexes and blocks traversal", async () => {
  const api = new TFlexApiClient({ baseUrl: fixtureBaseUrl, fetchTimeoutMs: 5_000 });
  assert.equal((await api.manifest()).counts.symbols, 3);
  assert.equal((await api.graphManifest()).counts.nodes, 8);

  const symbolResult = await api.searchSymbols("Document.Save", { limit: 5, assembly: "TFlex", kind: "method" });
  assert.equal(symbolResult.returned, 1);
  assert.equal(symbolResult.results[0].record.id, "M:TFlex.Model.Document.Save");

  const exact = await api.getSymbol("M:TFlex.Model.Document.Save");
  assert.equal(exact.exact, true);
  assert.equal(exact.record.name, "Save");

  const docsResult = await api.searchDocs("save document", { limit: 2 });
  assert.equal(docsResult.results[0].record.slug, "document-save");

  const capabilityResult = await api.searchCapabilities("document lifecycle", { limit: 2 });
  assert.equal(capabilityResult.results[0].record.capability_id, "document_lifecycle");

  const document = await api.getDocument("llm/types/TFlex__Document__fixture.md");
  assert.match(document.content, /Fixture type documentation/u);
  await assert.rejects(() => api.getDocument("../package.json"), /traversal/u);
});

test("stdio transport exposes and executes the MCP tools", async () => {
  const currentFile = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(currentFile), "..");
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, "src", "stdio.js")],
    cwd: repoRoot,
    env: { ...cleanEnv, TFLEX_API_BASE_URL: fixtureBaseUrl, TFLEX_FETCH_TIMEOUT_MS: "5000" }
  });
  const client = new Client({ name: "tflex-stdio-smoke", version: "1.0.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map(tool => tool.name).sort(),
      [
        "tflex_get_document",
        "tflex_get_symbol",
        "tflex_manifest",
        "tflex_search_capabilities",
        "tflex_search_docs",
        "tflex_search_symbols"
      ]
    );
    const called = await client.callTool({ name: "tflex_search_symbols", arguments: { query: "Document.Save", limit: 2 } });
    assert.equal(called.isError, undefined);
    assert.match(called.content[0].text, /M:TFlex\.Model\.Document\.Save/u);
  } finally {
    await client.close();
  }
});

test("Streamable HTTP transport initializes a session and calls a tool", async () => {
  const api = new TFlexApiClient({ baseUrl: fixtureBaseUrl, fetchTimeoutMs: 5_000 });
  const runtime = createHttpRuntime({ apiClient: api, logger: { error() {} } });
  const server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const readiness = await fetch(`${baseUrl}/readyz`);
  assert.equal(readiness.status, 200);
  assert.equal((await readiness.json()).counts.symbols, 3);

  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  const client = new Client({ name: "tflex-http-smoke", version: "1.0.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 6);
    const called = await client.callTool({ name: "tflex_manifest", arguments: {} });
    assert.match(called.content[0].text, /T-FLEX CAD 17 fixture/u);
  } finally {
    await client.close();
    await runtime.closeSessions();
    await new Promise(resolve => server.close(resolve));
  }
});
