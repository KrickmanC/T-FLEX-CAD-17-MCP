import assert from "node:assert/strict";
import { TFlexApiClient } from "../src/tflex-api.js";

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

console.log(JSON.stringify({
  status: "ok",
  api_base_url: api.baseUrl.href,
  dataset: manifest.dataset ?? manifest.source ?? manifest.project ?? "T-FLEX CAD 17 API",
  generated_at: manifest.generated_at ?? graphManifest.generated_at ?? null,
  counts: {
    assemblies: assemblyCount,
    types: typeCount,
    symbols: symbolCount,
    chm_pages: chmPageCount
  },
  graph_counts: {
    nodes: nodeCount,
    edges: edgeCount
  },
  capability_hits: capabilitySearch.returned,
  symbol_hits: symbolSearch.returned
}, null, 2));
