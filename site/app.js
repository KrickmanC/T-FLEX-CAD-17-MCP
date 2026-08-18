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
    setStatus("ok", "Доступен", API_BASE);
    byId("dataset").textContent = manifest.dataset || "T-FLEX CAD 17";
    const date = manifest.generated_at ? new Date(manifest.generated_at) : null;
    byId("generated").textContent = date && !Number.isNaN(date.valueOf())
      ? `Собрано: ${date.toLocaleString("ru-RU")}`
      : "Дата сборки не указана";
    setMetric("assemblies", manifest.counts?.assemblies);
    setMetric("types", manifest.counts?.types);
    setMetric("symbols", manifest.counts?.symbols);
    setMetric("topics", manifest.counts?.chm_pages);
    setMetric("nodes", graph.counts?.nodes);
    setMetric("edges", graph.counts?.edges);
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
