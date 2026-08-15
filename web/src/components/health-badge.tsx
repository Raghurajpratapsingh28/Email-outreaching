"use client";

import { useState } from "react";
import { useApi, postJson } from "@/lib/use-fetch";
import type { HealthResponse } from "@/lib/types";

const CONFIRM_PHRASE = "SEND REAL EMAILS";

export function HealthBadge() {
  const { data, error, refresh } = useApi<HealthResponse>("/api/health", 10_000);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function goLive() {
    setBusy(true);
    setActionError(null);
    try {
      await postJson("/api/send-mode/live", { confirm: confirmText });
      setConfirming(false);
      setConfirmText("");
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "failed to go live");
    } finally {
      setBusy(false);
    }
  }

  async function goDryRun() {
    setBusy(true);
    setActionError(null);
    try {
      await postJson("/api/send-mode/dry-run");
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "failed to switch to dry run");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-900 bg-red-950/50 px-3 py-1 text-xs text-red-300">
        <Dot className="bg-red-500" />
        API unreachable
      </span>
    );
  }

  if (!data) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-800 px-3 py-1 text-xs text-neutral-500">
        <Dot className="bg-neutral-600" />
        checking…
      </span>
    );
  }

  const ok = data.status === "ok";
  const live = !data.dryRun;

  return (
    <div className="relative flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
          ok
            ? "border-emerald-900 bg-emerald-950/50 text-emerald-300"
            : "border-amber-900 bg-amber-950/50 text-amber-300"
        }`}
      >
        <Dot className={ok ? "bg-emerald-500" : "bg-amber-500"} />
        {ok ? "API healthy" : "API degraded"}
      </span>

      <button
        onClick={() => {
          if (live) {
            void goDryRun();
          } else {
            setConfirming(true);
          }
        }}
        disabled={busy}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
          live
            ? "border-red-800 bg-red-950/60 text-red-300 hover:bg-red-900/60"
            : "border-blue-900 bg-blue-950/50 text-blue-300 hover:bg-blue-900/50"
        }`}
        title={
          live
            ? "LIVE — real email is being sent via Gmail SMTP. Click to switch back to dry run."
            : "No email is actually sent — every send is intercepted and logged instead. Click to go live."
        }
      >
        <Dot className={live ? "bg-red-500 animate-pulse" : "bg-blue-500"} />
        {live ? "LIVE SENDING — click to stop" : "DRY RUN — click to go live"}
      </button>

      {live && data.sendMode?.liveExpiresInSeconds !== null && data.sendMode?.liveExpiresInSeconds !== undefined && (
        <span className="text-[11px] text-neutral-500">
          auto-reverts in {Math.round(data.sendMode.liveExpiresInSeconds / 60)}m
        </span>
      )}

      {confirming && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-lg border border-red-800 bg-neutral-950 p-4 shadow-xl">
          <p className="text-sm font-semibold text-red-300">Go live?</p>
          <p className="mt-1 text-xs text-neutral-400">
            Every campaign with <code>dryRun: false</code> will actually send
            through Gmail SMTP from this moment on. This applies to the whole
            system, not one campaign. Type the phrase below to confirm.
          </p>
          <p className="mt-2 rounded bg-neutral-900 px-2 py-1 text-center font-mono text-xs text-neutral-300">
            {CONFIRM_PHRASE}
          </p>
          <input
            autoFocus
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type the phrase exactly"
            className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-100 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
          />
          {actionError && <p className="mt-1.5 text-xs text-red-400">{actionError}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => {
                setConfirming(false);
                setConfirmText("");
                setActionError(null);
              }}
              className="rounded-md px-2.5 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              onClick={goLive}
              disabled={busy || confirmText !== CONFIRM_PHRASE}
              className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-950 disabled:text-red-300/50"
            >
              {busy ? "Going live…" : "Confirm — go live"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={`h-1.5 w-1.5 rounded-full ${className}`} />;
}
