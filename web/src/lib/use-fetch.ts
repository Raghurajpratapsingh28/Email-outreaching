"use client";

import { useCallback, useEffect, useState } from "react";

interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Minimal client-side data hook — polls when `intervalMs` is given, otherwise
 * fetches once on mount. `refresh` lets a component trigger a manual reload
 * (e.g. right after an action like "launch campaign").
 */
export function useApi<T>(path: string | null, intervalMs?: number) {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    error: null,
    loading: path !== null,
  });

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const res = await fetch(path, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (body && typeof body === "object" && "error" in body
            ? String((body as { error: unknown }).error)
            : undefined) ?? `Request failed (${res.status})`,
        );
      }
      setState({ data: body as T, error: null, loading: false });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        error: err instanceof Error ? err.message : "request failed",
        loading: false,
      }));
    }
  }, [path]);

  useEffect(() => {
    if (!path) return;
    setState((prev) => ({ ...prev, loading: true }));
    void load();
    if (!intervalMs) return;
    const id = setInterval(() => void load(), intervalMs);
    return () => clearInterval(id);
  }, [path, intervalMs, load]);

  return { ...state, refresh: load };
}

export interface ApiError {
  error: string;
}

export async function postJson<T>(path: string, json?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: json !== undefined ? { "content-type": "application/json" } : undefined,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : undefined) ?? `Request failed (${res.status})`,
    );
  }
  return body as T;
}

export async function patchJson<T>(path: string, json: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(json),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : undefined) ?? `Request failed (${res.status})`,
    );
  }
  return body as T;
}
