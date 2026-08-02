/**
 * Typed fetch helper for the admin API. Cookie-authenticated (httpOnly
 * access/refresh cookies + a JS-readable CSRF cookie) — every mutating
 * request carries `x-csrf-token` per the server's double-submit check.
 */

const rawBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3100/api/v1";
/** Versioned API base, e.g. http://localhost:3100/api/v1 */
export const API_BASE = rawBase.replace(/\/+$/, "");
/** Unversioned base for /health/*, e.g. http://localhost:3100 */
export const SERVER_BASE = API_BASE.replace(/\/api\/v1$/, "");

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_COOKIE = "hh_csrf";

/** Reads the JS-readable hh_csrf cookie set at login. */
export function getCsrfCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const prefix = `${CSRF_COOKIE}=`;
  const found = document.cookie.split("; ").find((row) => row.startsWith(prefix));
  return found ? decodeURIComponent(found.slice(prefix.length)) : undefined;
}

export interface ApiErrorBody {
  code?: string;
  message?: string;
  [key: string]: unknown;
}

/** Thrown for any non-2xx response; carries the server's machine-readable code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message ?? body.code ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code ?? "unknown";
    this.body = body;
  }
}

export type ParseAs = "json" | "text" | "blob" | "none";

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  /** Plain object bodies are JSON.stringify'd automatically. Pass a FormData
   *  instance as-is for multipart uploads (content-type is left to fetch). */
  body?: unknown;
  parseAs?: ParseAs;
}

async function parseErrorBody(res: Response): Promise<ApiErrorBody> {
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as ApiErrorBody) : {};
  } catch {
    return {};
  }
}

async function doFetch<T>(base: string, path: string, options: ApiFetchOptions): Promise<T> {
  const { body, parseAs = "json", headers, method = "GET", ...rest } = options;
  const finalHeaders = new Headers(headers);
  const isMutating = MUTATING_METHODS.has(method.toUpperCase());

  let finalBody: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (body instanceof FormData) {
      finalBody = body;
    } else {
      finalHeaders.set("content-type", "application/json");
      finalBody = JSON.stringify(body);
    }
  }
  if (isMutating) {
    const csrf = getCsrfCookie();
    if (csrf) finalHeaders.set("x-csrf-token", csrf);
  }

  const init: RequestInit = {
    credentials: "include",
    method,
    headers: finalHeaders,
    ...rest,
  };
  if (finalBody !== undefined) {
    init.body = finalBody;
  }

  const res = await fetch(`${base}${path}`, init);

  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  if (parseAs === "none" || res.status === 204) {
    return undefined as T;
  }
  if (parseAs === "text") {
    return (await res.text()) as unknown as T;
  }
  if (parseAs === "blob") {
    return (await res.blob()) as unknown as T;
  }
  const text = await res.text();
  return (text ? (JSON.parse(text) as T) : (undefined as T));
}

/** Calls a versioned `/api/v1/...` admin endpoint. */
export function apiFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  return doFetch<T>(API_BASE, path, options);
}

/** Calls an unversioned server endpoint, e.g. /health/live. */
export function serverFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  return doFetch<T>(SERVER_BASE, path, options);
}
