const API_BASE = "https://raw.githubusercontent.com/KrickmanC/T-FLEX-CAD-17-API/main/";
const format = new Intl.NumberFormat("ru-RU");

const byId = id => document.getElementById(id);

function setStatus(kind, title, detail) {
  const dot = byId("api-dot");
  dot.className = `dot ${kind}`;
  byId("api-status").textContent = title;
  byId("api-detail").textContent = detail;
}

function setMetric(id, value) {
  byId(id).textContent = Number.isFinite(Number(value)) ? format.format(Number(value)) : "—";
}

async function getJson(relativePath) {
  const response = await fetch(`${API_BASE}${relativePath}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function refreshStatus() {
  setStatus("pending", "Проверка…", "Загрузка manifest.json");
  try {
    const [manifest, graph] = await Promise.all([
      getJson("llm/manifest.json"),
      getJson("graph/manifest.json")
    ]);
    const assemblies = manifest.counts?.assemblies
      ?? graph.counts?.assemblies
      ?? graph.assembly_count
      ?? graph.counters?.assemblies
      ?? (manifest.assemblies && typeof manifest.assemblies === "object" ? Object.keys(manifest.assemblies).length : 0);
    const types = manifest.counts?.types ?? manifest.type_page_count ?? graph.counts?.types ?? graph.counters?.types;
    const symbols = manifest.counts?.symbols ?? manifest.symbol_count;
    const topics = manifest.counts?.chm_pages ?? manifest.chm_page_count;
    const nodes = graph.counts?.nodes ?? graph.node_count;
    const edges = graph.counts?.edges ?? graph.edge_count;

    setStatus("ok", "Доступен", API_BASE);
    byId("dataset").textContent = manifest.dataset || manifest.source || manifest.project || "T-FLEX CAD 17";
    const generatedAt = manifest.generated_at || graph.generated_at;
    const date = generatedAt ? new Date(generatedAt) : null;
    byId("generated").textContent = date && !Number.isNaN(date.valueOf())
      ? `Собрано: ${date.toLocaleString("ru-RU")}`
      : "Дата сборки не указана";
    setMetric("assemblies", assemblies);
    setMetric("types", types);
    setMetric("symbols", symbols);
    setMetric("topics", topics);
    setMetric("nodes", nodes);
    setMetric("edges", edges);
  } catch (error) {
    setStatus("error", "Недоступен", error instanceof Error ? error.message : String(error));
  }
}

function normalizeRuntimeUrl(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Разрешены только http и https");
  url.pathname = url.pathname.replace(/\/(?:mcp|healthz|readyz)\/?$/, "").replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

async function checkRuntime() {
  const output = byId("runtime-result");
  output.className = "result muted";
  output.textContent = "Проверка…";
  try {
    const base = normalizeRuntimeUrl(byId("runtime-url").value.trim());
    const [healthResponse, readyResponse] = await Promise.all([
      fetch(new URL(`${base.pathname}/healthz`, base), { cache: "no-store" }),
      fetch(new URL(`${base.pathname}/readyz`, base), { cache: "no-store" })
    ]);
    const health = await healthResponse.json();
    const ready = await readyResponse.json();
    if (!healthResponse.ok || !readyResponse.ok) throw new Error(ready.error || health.error || "runtime returned an error");
    output.className = "result ok-result";
    output.textContent = `Runtime доступен · ${health.service || "MCP"} ${health.version || ""} · symbols: ${format.format(ready.counts?.symbols || 0)}`;
  } catch (error) {
    output.className = "result error-result";
    output.textContent = `Ошибка: ${error instanceof Error ? error.message : String(error)}`;
  }
}

byId("refresh").addEventListener("click", refreshStatus);
byId("check-runtime").addEventListener("click", checkRuntime);
refreshStatus();
