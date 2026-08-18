import assert from "node:assert/strict";
import { TFlexApiClient } from "../src/tflex-api.js";

const api = new TFlexApiClient();
const [manifest, graphManifest] = await Promise.all([api.manifest(), api.graphManifest()]);

assert.equal(manifest.schema_version, "1.0.0");
assert.ok(manifest.counts?.assemblies >= 1, "manifest must contain assemblies");
assert.ok(manifest.counts?.types >= 1, "manifest must contain types");
assert.ok(manifest.counts?.symbols >= 1, "manifest must contain symbols");
assert.ok(manifest.counts?.chm_pages >= 1, "manifest must contain CHM pages");
assert.ok(graphManifest.counts?.nodes >= 1, "graph manifest must contain nodes");
assert.ok(graphManifest.counts?.edges >= 1, "graph manifest must contain edges");

const capabilitySearch = await api.searchCapabilities("document lifecycle", { limit: 3 });
assert.ok(capabilitySearch.returned >= 1, "capability search must return at least one result");

const symbolSearch = await api.searchSymbols("Document", { limit: 3 });
assert.ok(symbolSearch.returned >= 1, "symbol search must return at least one result");

console.log(JSON.stringify({
  status: "ok",
  api_base_url: api.baseUrl.href,
  dataset: manifest.dataset,
  generated_at: manifest.generated_at,
  counts: manifest.counts,
  graph_counts: graphManifest.counts,
  capability_hits: capabilitySearch.returned,
  symbol_hits: symbolSearch.returned
}, null, 2));
