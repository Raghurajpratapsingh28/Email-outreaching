import "server-only";

/**
 * Thin fetch wrapper around the Fastify API. Server-only: the backend URL
 * and any future auth token never reach the browser bundle. Next.js route
 * handlers under src/app/api/* are the only callers — the browser talks to
 * those (same-origin), never directly to the backend, so there is no CORS
 * concern to configure on either side.
 */

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);
  let body = rest.body;

  if (json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(json);
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      ...rest,
      body,
      headers,
      cache: "no-store",
    });
  } catch {
    throw new BackendError(
      `Cannot reach the API at ${BACKEND_URL} — is it running?`,
      503,
      null,
    );
  }

  const text = await res.text();
  const data = text ? safeJsonParse(text) : null;

  if (!res.ok) {
    const message =
      (data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : undefined) ?? `Request failed with status ${res.status}`;
    throw new BackendError(message, res.status, data);
  }

  return data as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function backendErrorResponse(err: unknown): Response {
  if (err instanceof BackendError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return Response.json({ error: "unexpected error" }, { status: 500 });
}

export const backend = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, json?: unknown) =>
    request<T>(path, { method: "POST", json }),
  patch: <T>(path: string, json?: unknown) =>
    request<T>(path, { method: "PATCH", json }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  /** For multipart uploads (PDF import) — body must be a FormData instance. */
  postForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: "POST", body: form }),
};
