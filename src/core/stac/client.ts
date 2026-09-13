import type { Geometry } from "geojson";

import type { StacProvider } from "@/core/stac/providers/copernicus";
import { VERSION } from "@/version";

export interface StacAsset {
  href?: string;
  title?: string;
  description?: string;
  type?: string;
  roles?: string[];
  gsd?: number;
  "eo:bands"?: StacBand[];
  bands?: StacBand[];
}

export interface StacBand {
  name?: string;
  description?: string;
  "eo:common_name"?: string;
  "eo:center_wavelength"?: number;
}

export interface StacItem {
  id: string;
  collection?: string;
  bbox?: number[];
  geometry: Geometry | null;
  properties: Record<string, unknown>;
  assets?: Record<string, StacAsset>;
}

export interface StacCollection {
  id: string;
  title?: string;
  description?: string;
  item_assets?: Record<string, StacAsset>;
}

interface StacLink {
  rel: string;
  href: string;
  method?: string;
  body?: Record<string, unknown>;
}

interface StacItemCollection {
  features?: StacItem[];
  links?: StacLink[];
}

/** Body of a STAC API `POST /search`. */
export interface StacSearchBody {
  collections: string[];
  intersects?: Geometry;
  bbox?: number[];
  datetime?: string;
  limit?: number;
  sortby?: Array<{ field: string; direction: "asc" | "desc" }>;
  filter?: unknown;
  "filter-lang"?: "cql2-json";
  fields?: { include?: string[]; exclude?: string[] };
  [key: string]: unknown;
}

export interface RequestOptions {
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Extra attempts for 429/5xx and network errors. Defaults to 3. */
  retries?: number;
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export interface SearchStacOptions extends RequestOptions {
  /** Stop after this many items. */
  maxItems: number;
  onPage?: (itemsSoFar: number) => void;
}

export interface SearchStacResult {
  items: StacItem[];
  /** `true` when more items matched than `maxItems`. */
  truncated: boolean;
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pulls the most useful message out of an error response. */
async function describeFailure(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as {
      detail?: { message?: string } | string;
      description?: string;
      message?: string;
    };
    const detail =
      typeof body.detail === "string" ? body.detail : body.detail?.message;
    const message = detail ?? body.description ?? body.message;
    if (message) return message;
  } catch {
    // Not JSON: fall back to the raw text below.
  }
  return text.slice(0, 300) || response.statusText;
}

function retryDelay(response: Response | undefined, attempt: number): number {
  const header = response?.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 30) * 1000;
  return 1000 * 2 ** attempt;
}

/** JSON request with timeout and retries on transient failures. */
export async function stacRequest<T>(
  url: string,
  init: { method: "GET" | "POST"; body?: unknown },
  options: RequestOptions,
): Promise<T> {
  const doFetch = options.fetch ?? fetch;
  const retries = options.retries ?? 3;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response: Response | undefined;
    try {
      response = await doFetch(url, {
        method: init.method,
        headers: {
          Accept: "application/geo+json, application/json",
          "User-Agent": `geoaltia-cli/${VERSION}`,
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      lastError = new Error(
        timedOut
          ? `El catálogo no respondió en ${Math.round(options.timeoutMs / 1000)} s.`
          : `No se pudo conectar con el catálogo (${error instanceof Error ? error.message : String(error)}).`,
      );
      if (attempt < retries) {
        await sleep(retryDelay(undefined, attempt));
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    const message = `El catálogo respondió ${response.status}: ${await describeFailure(response)}`;
    lastError = new Error(message);
    if (RETRY_STATUS.has(response.status) && attempt < retries) {
      await sleep(retryDelay(response, attempt));
      continue;
    }
    throw lastError;
  }

  throw lastError ?? new Error("Error desconocido consultando el catálogo.");
}

/** Reads a collection document (title, description, `item_assets`). */
export function fetchCollection(
  provider: StacProvider,
  id: string,
  options: RequestOptions,
): Promise<StacCollection> {
  return stacRequest<StacCollection>(
    `${provider.url}/collections/${encodeURIComponent(id)}`,
    { method: "GET" },
    options,
  );
}

/**
 * Runs a search and follows `next` links until there are no more pages or
 * `maxItems` is exceeded. One extra item is requested to know, exactly,
 * whether the result was truncated.
 */
export async function searchStac(
  provider: StacProvider,
  body: StacSearchBody,
  options: SearchStacOptions,
): Promise<SearchStacResult> {
  const items: StacItem[] = [];
  const pageLimit = (): number =>
    Math.max(1, Math.min(provider.maxPageSize, options.maxItems - items.length + 1));

  let url = `${provider.url}/search`;
  let method: "GET" | "POST" = "POST";
  let requestBody: Record<string, unknown> | undefined = { ...body, limit: pageLimit() };

  for (;;) {
    const page: StacItemCollection = await stacRequest<StacItemCollection>(
      url,
      { method, ...(requestBody ? { body: requestBody } : {}) },
      options,
    );
    const features = page.features ?? [];
    items.push(...features);
    options.onPage?.(Math.min(items.length, options.maxItems));

    if (items.length > options.maxItems) {
      return { items: items.slice(0, options.maxItems), truncated: true };
    }

    const next: StacLink | undefined = page.links?.find((link: StacLink) => link.rel === "next");
    if (!next || features.length === 0) {
      return { items, truncated: false };
    }

    url = next.href;
    if ((next.method ?? "GET").toUpperCase() === "POST") {
      method = "POST";
      requestBody = { ...body, ...(next.body ?? {}), limit: pageLimit() };
    } else {
      method = "GET";
      requestBody = undefined;
    }
  }
}
