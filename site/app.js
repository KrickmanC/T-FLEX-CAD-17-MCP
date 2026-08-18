const API_BASE = "https://raw.githubusercontent.com/KrickmanC/T-FLEX-CAD-17-API/main/";

const translations = {
  en: {
    navAria: "Main navigation",
    architectureAria: "Architecture",
    navStatus: "Status",
    navTools: "Tools",
    navRun: "Run",
    heroTitle: "MCP access to the<br>T-FLEX CAD 17 knowledge base",
    heroLead: "A dedicated MCP layer for searching API symbols, documentation and the capability map. Canonical data remains in <code>T-FLEX-CAD-17-API</code>.",
    clientTitle: "MCP client",
    clientDetail: "Claude, ChatGPT, IDE, agent",
    pagesBoundary: "<strong>GitHub Pages boundary:</strong> Pages publishes this static dashboard. The executable Node.js MCP runtime runs locally, in Docker, or on a separate compute host such as Render, Railway or a VPS.",
    statusTitle: "Data layer status",
    refresh: "Refresh",
    checking: "Checking…",
    loadingManifest: "Loading manifest.json",
    available: "Available",
    unavailable: "Unavailable",
    generated: "Generated",
    generatedUnknown: "Build date is not specified",
    toolsTitle: "MCP tools",
    toolManifest: "Dataset and graph manifests.",
    toolSearchSymbols: "Search types, methods, properties and events.",
    toolGetSymbol: "Resolve a symbol by exact identifier.",
    toolSearchDocs: "Full-text search across the CHM index.",
    toolCapabilities: "Search the application capability map.",
    toolDocument: "Read an allowlisted document by relative path.",
    runTitle: "Run MCP",
    runtimeCheckTitle: "Check a deployed runtime",
    runtimeBaseUrl: "Runtime base URL",
    check: "Check",
    runtimeHint: "Enter a service URL that exposes <code>/healthz</code> and <code>/readyz</code>.",
    runtimeChecking: "Checking…",
    runtimeAvailable: "Runtime available",
    runtimeError: "Error",
    httpOnly: "Only http and https are allowed",
    statusLayer: "Knowledge/API layer",
    datasetLabel: "Documentation dataset",
    assemblies: "Assemblies",
    types: "Types",
    symbols: "Symbols",
    topics: "CHM topics",
    graphNodes: "Graph nodes",
    graphEdges: "Graph edges",
    footerAdapter: "Read-only adapter over T-FLEX-CAD-17-API"
  },
  ru: {
    navAria: "Основная навигация",
    architectureAria: "Архитектура",
    navStatus: "Статус",
    navTools: "Инструменты",
    navRun: "Запуск",
    heroTitle: "MCP-доступ к базе знаний<br>T-FLEX CAD 17",
    heroLead: "Отдельный MCP-слой для поиска API-символов, документации и карты возможностей. Канонические данные остаются в <code>T-FLEX-CAD-17-API</code>.",
    clientTitle: "MCP-клиент",
    clientDetail: "Claude, ChatGPT, IDE, агент",
    pagesBoundary: "<strong>Граница GitHub Pages:</strong> Pages публикует эту статическую панель. Исполняемый Node.js MCP runtime запускается локально, в Docker либо на отдельном compute-host, например Render, Railway или VPS.",
    statusTitle: "Состояние слоя данных",
    refresh: "Обновить",
    checking: "Проверка…",
    loadingManifest: "Загрузка manifest.json",
    available: "Доступен",
    unavailable: "Недоступен",
    generated: "Собрано",
    generatedUnknown: "Дата сборки не указана",
    toolsTitle: "Инструменты MCP",
    toolManifest: "Манифест набора данных и графа.",
    toolSearchSymbols: "Поиск типов, методов, свойств и событий.",
    toolGetSymbol: "Получение символа по точному идентификатору.",
    toolSearchDocs: "Полнотекстовый поиск по индексу CHM.",
    toolCapabilities: "Поиск по карте прикладных возможностей.",
    toolDocument: "Чтение разрешённого документа по относительному пути.",
    runTitle: "Запуск MCP",
    runtimeCheckTitle: "Проверка развёрнутого процесса",
    runtimeBaseUrl: "Базовый URL runtime",
    check: "Проверить",
    runtimeHint: "Введите URL сервиса, у которого доступны <code>/healthz</code> и <code>/readyz</code>.",
    runtimeChecking: "Проверка…",
    runtimeAvailable: "Runtime доступен",
    runtimeError: "Ошибка",
    httpOnly: "Разрешены только http и https",
    statusLayer: "Слой Knowledge/API",
    datasetLabel: "Набор документации",
    assemblies: "Сборки",
    types: "Типы",
    symbols: "Символы",
    topics: "Темы CHM",
    graphNodes: "Узлы графа",
    graphEdges: "Связи графа",
    footerAdapter: "Read-only адаптер поверх T-FLEX-CAD-17-API"
  }
};

const byId = id => document.getElementById(id);
const storedLanguage = localStorage.getItem("tflex-mcp-language");
let currentLanguage = storedLanguage === "ru" || storedLanguage === "en" ? storedLanguage : "en";

function t(key) {
  return translations[currentLanguage][key] ?? translations.en[key] ?? key;
}

function locale() {
  return currentLanguage === "ru" ? "ru-RU" : "en-US";
}

function formatNumber(value) {
  return new Intl.NumberFormat(locale()).format(Number(value));
}

function applyLanguage(language, persist = true) {
  currentLanguage = language === "ru" ? "ru" : "en";
  document.documentElement.lang = currentLanguage;

  document.querySelectorAll("[data-i18n]").forEach(element => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-html]").forEach(element => {
    element.innerHTML = t(element.dataset.i18nHtml);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach(element => {
    element.setAttribute("aria-label", t(element.dataset.i18nAria));
  });

  document.querySelectorAll(".language-option").forEach(button => {
    const active = button.dataset.lang === currentLanguage;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  if (persist) localStorage.setItem("tflex-mcp-language", currentLanguage);
}

function setStatus(kind, title, detail) {
  const dot = byId("api-dot");
  dot.className = `dot ${kind}`;
  byId("api-status").textContent = title;
  byId("api-detail").textContent = detail;
}

function setMetric(id, value) {
  byId(id).textContent = Number.isFinite(Number(value)) ? formatNumber(value) : "—";
}

async function getJson(relativePath) {
  const response = await fetch(`${API_BASE}${relativePath}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function refreshStatus() {
  setStatus("pending", t("checking"), t("loadingManifest"));
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

    setStatus("ok", t("available"), API_BASE);
    byId("dataset").textContent = manifest.dataset || manifest.source || manifest.project || "T-FLEX CAD 17";
    const generatedAt = manifest.generated_at || graph.generated_at;
    const date = generatedAt ? new Date(generatedAt) : null;
    byId("generated").textContent = date && !Number.isNaN(date.valueOf())
      ? `${t("generated")}: ${date.toLocaleString(locale())}`
      : t("generatedUnknown");
    setMetric("assemblies", assemblies);
    setMetric("types", types);
    setMetric("symbols", symbols);
    setMetric("topics", topics);
    setMetric("nodes", nodes);
    setMetric("edges", edges);
  } catch (error) {
    setStatus("error", t("unavailable"), error instanceof Error ? error.message : String(error));
  }
}

function normalizeRuntimeUrl(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error(t("httpOnly"));
  url.pathname = url.pathname.replace(/\/(?:mcp|healthz|readyz)\/?$/, "").replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

async function checkRuntime() {
  const output = byId("runtime-result");
  output.className = "result muted";
  output.textContent = t("runtimeChecking");
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
    output.textContent = `${t("runtimeAvailable")} · ${health.service || "MCP"} ${health.version || ""} · symbols: ${formatNumber(ready.counts?.symbols || 0)}`;
  } catch (error) {
    output.className = "result error-result";
    output.textContent = `${t("runtimeError")}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

byId("refresh").addEventListener("click", refreshStatus);
byId("check-runtime").addEventListener("click", checkRuntime);
document.querySelectorAll(".language-option").forEach(button => {
  button.addEventListener("click", () => {
    applyLanguage(button.dataset.lang);
    byId("runtime-result").className = "result muted";
    byId("runtime-result").innerHTML = t("runtimeHint");
    void refreshStatus();
  });
});

applyLanguage(currentLanguage, false);
refreshStatus();
