import path from "node:path";

export const DEFAULT_API_BASE_URL = "https://raw.githubusercontent.com/KrickmanC/T-FLEX-CAD-17-API/main/";

const DEFAULT_PATHS = Object.freeze({
  manifest: "llm/manifest.json",
  graphManifest: "graph/manifest.json",
  symbols: "llm/symbols.jsonl",
  docs: "llm/chm_pages.jsonl",
  capabilities: "graph/capabilities.seed.jsonl"
});

const ALLOWED_DOCUMENT_PREFIXES = Object.freeze([
  "llm/types/",
  "llm/assemblies/",
  "chm/",
  "xml-api/",
  "graph/"
]);

const ALLOWED_DOCUMENT_FILES = new Set([
  "README.md",
  "llm/manifest.json",
  "graph/manifest.json"
]);

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return parsed;
}

function normalizedBaseUrl(value) {
  const url = new URL(value || DEFAULT_API_BASE_URL);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("TFLEX_API_BASE_URL must use http or https");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.search = "";
  url.hash = "";
  return url;
}

export function loadConfig(env = process.env) {
  return Object.freeze({
    baseUrl: normalizedBaseUrl(env.TFLEX_API_BASE_URL || DEFAULT_API_BASE_URL).href,
    fetchTimeoutMs: positiveInteger(env.TFLEX_FETCH_TIMEOUT_MS, 45_000, "TFLEX_FETCH_TIMEOUT_MS"),
    cacheTtlMs: positiveInteger(env.TFLEX_CACHE_TTL_MS, 300_000, "TFLEX_CACHE_TTL_MS"),
    maxDatasetBytes: positiveInteger(env.TFLEX_MAX_DATASET_BYTES, 64 * 1024 * 1024, "TFLEX_MAX_DATASET_BYTES"),
    maxDocumentBytes: positiveInteger(env.TFLEX_MAX_DOCUMENT_BYTES, 2 * 1024 * 1024, "TFLEX_MAX_DOCUMENT_BYTES"),
    maxToolOutputChars: positiveInteger(env.MCP_MAX_TOOL_OUTPUT_CHARS, 120_000, "MCP_MAX_TOOL_OUTPUT_CHARS"),
    host: env.MCP_HOST || "0.0.0.0",
    port: positiveInteger(env.MCP_PORT || env.PORT, 3000, "MCP_PORT"),
    allowedOrigins: (env.MCP_ALLOWED_ORIGINS || "*")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean)
  });
}

export function normalizeRelativePath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("relative path must be a non-empty string");
  }

  const candidate = value.trim().replaceAll("\\", "/");
  if (candidate.includes("\0") || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(candidate) || candidate.startsWith("/")) {
    throw new TypeError("absolute URLs and paths are not allowed");
  }

  const normalized = path.posix.normalize(candidate).replace(/^\.\//, "");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new TypeError("path traversal is not allowed");
  }
  return normalized;
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ")
    .trim();
}

function collectScalarStrings(value, target, depth = 0) {
  if (target.length >= 256 || depth > 4 || value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    target.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 64)) collectScalarStrings(item, target, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value).slice(0, 128)) {
      target.push(key);
      collectScalarStrings(item, target, depth + 1);
    }
  }
}

function searchableText(record) {
  const values = [];
  collectScalarStrings(record, values);
  return normalizeSearchText(values.join(" \n "));
}

function valuesForMatchingKeys(record, matcher, depth = 0, output = []) {
  if (depth > 3 || record === null || typeof record !== "object") return output;
  if (Array.isArray(record)) {
    for (const item of record.slice(0, 32)) valuesForMatchingKeys(item, matcher, depth + 1, output);
    return output;
  }
  for (const [key, value] of Object.entries(record)) {
    if (matcher.test(key)) {
      const strings = [];
      collectScalarStrings(value, strings);
      output.push(...strings);
    }
    if (value && typeof value === "object") valuesForMatchingKeys(value, matcher, depth + 1, output);
  }
  return output;
}

function identityValues(record) {
  return valuesForMatchingKeys(
    record,
    /^(?:id|uid|name|title|slug|symbol|symbol_id|member|member_id|xml_id|full_name|qualified_name|signature)$/iu
  ).map(normalizeSearchText);
}

function scoreRecord(record, query, tokens) {
  const haystack = searchableText(record);
  if (!haystack) return 0;

  const identities = identityValues(record);
  let score = 0;
  if (identities.includes(query)) score += 300;
  if (identities.some(value => value.startsWith(query))) score += 180;
  if (identities.some(value => value.includes(query))) score += 120;
  if (haystack.includes(query)) score += 80;

  let matchedTokens = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) matchedTokens += 1;
  }
  if (matchedTokens === tokens.length) score += 40 + matchedTokens * 8;
  else score += matchedTokens * 3;

  return score;
}

function matchesFieldFilter(record, matcher, expected) {
  if (!expected) return true;
  const values = valuesForMatchingKeys(record, matcher).map(normalizeSearchText);
  if (values.length === 0) return false;
  const needle = normalizeSearchText(expected);
  return values.some(value => value === needle || value.includes(needle));
}

function compactValue(value, maxStringLength = 2_000, depth = 0) {
  if (typeof value === "string") {
    return value.length <= maxStringLength ? value : `${value.slice(0, maxStringLength)}…`;
  }
  if (value === null || typeof value !== "object") return value;
  if (depth > 5) return "[depth limited]";
  if (Array.isArray(value)) return value.slice(0, 64).map(item => compactValue(item, maxStringLength, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 128)
      .map(([key, item]) => [key, compactValue(item, maxStringLength, depth + 1)])
  );
}

export class TFlexApiClient {
  constructor(options = {}) {
    const config = options.config || loadConfig(options.env);
    this.baseUrl = normalizedBaseUrl(options.baseUrl || config.baseUrl);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== "function") throw new TypeError("A fetch implementation is required");
    this.fetchTimeoutMs = options.fetchTimeoutMs || config.fetchTimeoutMs;
    this.cacheTtlMs = options.cacheTtlMs || config.cacheTtlMs;
    this.maxDatasetBytes = options.maxDatasetBytes || config.maxDatasetBytes;
    this.maxDocumentBytes = options.maxDocumentBytes || config.maxDocumentBytes;
    this.cache = new Map();
  }

  resolve(relativePath) {
    const safePath = normalizeRelativePath(relativePath);
    const url = new URL(safePath, this.baseUrl);
    if (url.origin !== this.baseUrl.origin || !url.pathname.startsWith(this.baseUrl.pathname)) {
      throw new TypeError("resolved URL escapes the configured API base path");
    }
    return url;
  }

  clearCache() {
    this.cache.clear();
  }

  async fetchText(relativePath, options = {}) {
    const safePath = normalizeRelativePath(relativePath);
    const maxBytes = options.maxBytes || this.maxDatasetBytes;
    const cacheKey = `text:${safePath}:${maxBytes}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    timeout.unref?.();

    try {
      const response = await this.fetchImpl(this.resolve(safePath), {
        method: "GET",
        headers: {
          accept: "application/json, application/x-ndjson, text/markdown, text/plain;q=0.9, */*;q=0.1",
          "user-agent": "T-FLEX-CAD-17-MCP/1.0"
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`T-FLEX API request failed: ${response.status} ${response.statusText} (${safePath})`);
      }

      const declaredLength = Number.parseInt(response.headers.get("content-length") || "0", 10);
      if (declaredLength > maxBytes) {
        throw new Error(`T-FLEX API response exceeds ${maxBytes} bytes (${safePath})`);
      }

      const chunks = [];
      let total = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel("size limit exceeded");
            throw new Error(`T-FLEX API response exceeds ${maxBytes} bytes (${safePath})`);
          }
          chunks.push(value);
        }
      } else {
        const value = new Uint8Array(await response.arrayBuffer());
        total = value.byteLength;
        if (total > maxBytes) throw new Error(`T-FLEX API response exceeds ${maxBytes} bytes (${safePath})`);
        chunks.push(value);
      }

      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const text = new TextDecoder("utf-8", { fatal: false }).decode(merged);
      this.cache.set(cacheKey, { value: text, expiresAt: Date.now() + this.cacheTtlMs });
      return text;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`T-FLEX API request timed out after ${this.fetchTimeoutMs} ms (${safePath})`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchJson(relativePath) {
    const safePath = normalizeRelativePath(relativePath);
    const cacheKey = `json:${safePath}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const text = await this.fetchText(safePath);
    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new Error(`Invalid JSON in ${safePath}: ${error.message}`);
    }
    this.cache.set(cacheKey, { value, expiresAt: Date.now() + this.cacheTtlMs });
    return value;
  }

  async fetchJsonl(relativePath) {
    const safePath = normalizeRelativePath(relativePath);
    const cacheKey = `jsonl:${safePath}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const text = await this.fetchText(safePath);
    const records = [];
    const lines = text.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      try {
        records.push(JSON.parse(line));
      } catch (error) {
        throw new Error(`Invalid JSONL in ${safePath} at line ${index + 1}: ${error.message}`);
      }
    }
    this.cache.set(cacheKey, { value: records, expiresAt: Date.now() + this.cacheTtlMs });
    return records;
  }

  async manifest() {
    return this.fetchJson(DEFAULT_PATHS.manifest);
  }

  async graphManifest() {
    return this.fetchJson(DEFAULT_PATHS.graphManifest);
  }

  async searchJsonl(relativePath, query, options = {}) {
    const normalizedQuery = normalizeSearchText(query);
    if (normalizedQuery.length < 2) throw new TypeError("query must contain at least two characters");
    const tokens = [...new Set(normalizedQuery.split(/[^\p{L}\p{N}_.:#]+/u).filter(token => token.length >= 2))];
    const limit = Math.max(1, Math.min(Number(options.limit) || 10, 50));
    const records = await this.fetchJsonl(relativePath);
    const ranked = [];

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!matchesFieldFilter(record, /assembly/iu, options.assembly)) continue;
      if (!matchesFieldFilter(record, /(?:kind|type|category)/iu, options.kind)) continue;
      const score = scoreRecord(record, normalizedQuery, tokens);
      if (score > 0) ranked.push({ score, index, record });
    }

    ranked.sort((left, right) => right.score - left.score || left.index - right.index);
    return {
      query,
      total_scanned: records.length,
      total_matches: ranked.length,
      returned: Math.min(limit, ranked.length),
      results: ranked.slice(0, limit).map(item => ({
        score: item.score,
        record: compactValue(item.record)
      }))
    };
  }

  async searchSymbols(query, options = {}) {
    return this.searchJsonl(DEFAULT_PATHS.symbols, query, options);
  }

  async getSymbol(identifier) {
    const needle = normalizeSearchText(identifier);
    if (needle.length < 2) throw new TypeError("identifier must contain at least two characters");
    const records = await this.fetchJsonl(DEFAULT_PATHS.symbols);
    const exact = records.find(record => identityValues(record).includes(needle));
    if (exact) return { found: true, exact: true, record: compactValue(exact, 8_000) };
    const search = await this.searchSymbols(identifier, { limit: 1 });
    if (search.results.length === 0) return { found: false, exact: false, identifier };
    return { found: true, exact: false, identifier, ...search.results[0] };
  }

  async searchDocs(query, options = {}) {
    return this.searchJsonl(DEFAULT_PATHS.docs, query, options);
  }

  async searchCapabilities(query, options = {}) {
    return this.searchJsonl(DEFAULT_PATHS.capabilities, query, options);
  }

  async getDocument(relativePath) {
    const safePath = normalizeRelativePath(relativePath);
    const allowed = ALLOWED_DOCUMENT_FILES.has(safePath)
      || ALLOWED_DOCUMENT_PREFIXES.some(prefix => safePath.startsWith(prefix));
    if (!allowed) {
      throw new TypeError(`document path is outside the read-only allowlist: ${safePath}`);
    }
    const content = await this.fetchText(safePath, { maxBytes: this.maxDocumentBytes });
    return {
      path: safePath,
      url: this.resolve(safePath).href,
      bytes: new TextEncoder().encode(content).byteLength,
      content
    };
  }
}
