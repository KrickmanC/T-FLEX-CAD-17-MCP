import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TFlexApiClient } from "../src/tflex-api.js";

const RUNTIME_BASE = "https://t-flex-cad-17-mcp.onrender.com";

async function fetchJsonWithRetry(pathname, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${RUNTIME_BASE}${pathname}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(45_000)
      });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { raw: text }; }
      if (!response.ok) throw new Error(`${pathname}: HTTP ${response.status} ${JSON.stringify(body)}`);
      return { response, body };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 5_000));
    }
  }
  throw lastError;
}

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

// Canonical knowledge/API layer smoke test.
const api = new TFlexApiClient();
const [manifest, graphManifest] = await Promise.all([api.manifest(), api.graphManifest()]);

const assemblyCount = manifest.counts?.assemblies
  ?? graphManifest.counts?.assemblies
  ?? graphManifest.assembly_count
  ?? graphManifest.counters?.assemblies
  ?? (manifest.assemblies && typeof manifest.assemblies === "object" ? Object.keys(manifest.assemblies).length : 0);
const typeCount = manifest.counts?.types
  ?? manifest.type_page_count
  ?? graphManifest.counts?.types
  ?? graphManifest.counters?.types
  ?? 0;
const symbolCount = manifest.counts?.symbols ?? manifest.symbol_count ?? 0;
const chmPageCount = manifest.counts?.chm_pages ?? manifest.chm_page_count ?? 0;
const nodeCount = graphManifest.counts?.nodes ?? graphManifest.node_count ?? 0;
const edgeCount = graphManifest.counts?.edges ?? graphManifest.edge_count ?? 0;

assert.ok(assemblyCount >= 1, "manifest must contain assemblies");
assert.ok(typeCount >= 1, "manifest must contain types");
assert.ok(symbolCount >= 1, "manifest must contain symbols");
assert.ok(chmPageCount >= 1, "manifest must contain CHM pages");
assert.ok(nodeCount >= 1, "graph manifest must contain nodes");
assert.ok(edgeCount >= 1, "graph manifest must contain edges");

const capabilitySearch = await api.searchCapabilities("активный документ", { limit: 3 });
assert.ok(capabilitySearch.returned >= 1, "capability search must return at least one result");
const symbolSearch = await api.searchSymbols("Document", { limit: 3 });
assert.ok(symbolSearch.returned >= 1, "symbol search must return at least one result");

// Public Render runtime liveness/readiness.
const [{ body: health }, { body: ready }] = await Promise.all([
  fetchJsonWithRetry("/healthz"),
  fetchJsonWithRetry("/readyz")
]);
assert.equal(health.status, "ok");
assert.equal(ready.status, "ready");
assert.ok(ready.counts?.symbols >= 1, "runtime readiness must report symbols");

// Actual MCP initialize -> tools/list -> tools/call over Streamable HTTP.
const transport = new StreamableHTTPClientTransport(new URL(`${RUNTIME_BASE}/mcp`));
const client = new Client({ name: "render-live-smoke", version: "1.0.0" });
let listed;
let manifestCall;
let symbolCall;
try {
  await withTimeout(client.connect(transport), 90_000, "MCP initialize");
  listed = await withTimeout(client.listTools(), 45_000, "tools/list");
  const toolNames = listed.tools.map(tool => tool.name).sort();
  assert.deepEqual(toolNames, [
    "tflex_get_document",
    "tflex_get_symbol",
    "tflex_manifest",
    "tflex_search_capabilities",
    "tflex_search_docs",
    "tflex_search_symbols"
  ]);

  manifestCall = await withTimeout(
    client.callTool({ name: "tflex_manifest", arguments: {} }),
    60_000,
    "tflex_manifest"
  );
  assert.equal(manifestCall.isError, undefined);
  assert.match(manifestCall.content?.[0]?.text || "", /T-FLEX CAD 17/u);

  symbolCall = await withTimeout(
    client.callTool({ name: "tflex_search_symbols", arguments: { query: "Document", limit: 1 } }),
    90_000,
    "tflex_search_symbols"
  );
  assert.equal(symbolCall.isError, undefined);
  assert.match(symbolCall.content?.[0]?.text || "", /Document/u);
} finally {
  await client.close().catch(() => {});
}

console.log(JSON.stringify({
  status: "ok",
  runtime: RUNTIME_BASE,
  health,
  readiness: {
    status: ready.status,
    api_base_url: ready.api_base_url,
    counts: ready.counts,
    graph_counts: ready.graph_counts
  },
  mcp: {
    initialized: true,
    tools: listed.tools.map(tool => tool.name),
    tflex_manifest: "ok",
    tflex_search_symbols: "ok"
  },
  api_base_url: api.baseUrl.href,
  capability_hits: capabilitySearch.returned,
  symbol_hits: symbolSearch.returned
}, null, 2));
