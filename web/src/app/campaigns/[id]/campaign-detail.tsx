"use client";

import { useState } from "react";
import { useApi, postJson } from "@/lib/use-fetch";
import type {
  Campaign,
  CampaignStats,
  CampaignPreviewItem,
  StartCampaignResult,
  HealthResponse,
} from "@/lib/types";
import { Alert, Button, Card, CardBody, CardHeader, StatusBadge } from "@/components/ui";

const POLL_MS = 2000;

export function CampaignDetail({ campaignId }: { campaignId: number }) {
  const { data: campaign, refresh: refreshCampaign } = useApi<Campaign>(
    `/api/campaigns/${campaignId}`,
    POLL_MS,
  );
  const isActive = campaign?.status === "running";
  const { data: stats, refresh: refreshStats } = useApi<CampaignStats>(
    `/api/campaigns/${campaignId}/stats`,
    isActive ? POLL_MS : 8000,
  );
  // The global send-mode switch overrides every campaign's own dryRun flag —
  // a campaign with dryRun:false still sends nothing (marked "skipped") while
  // the system-wide switch is dry-run. Polled here so this page can't lie
  // about whether launching will actually send anything.
  const { data: health } = useApi<HealthResponse>("/api/health", 5000);
  const globallyDryRun = health?.dryRun ?? true;

  const [actionError, setActionError] = useState<string | null>(null);
  const [actioning, setActioning] = useState(false);
  const [lastResult, setLastResult] = useState<StartCampaignResult | null>(null);

  async function runAction(action: "start" | "pause" | "resume") {
    setActioning(true);
    setActionError(null);
    try {
      const result = await postJson<StartCampaignResult | Campaign>(
        `/api/campaigns/${campaignId}/${action}`,
      );
      if (action !== "pause") setLastResult(result as StartCampaignResult);
      await Promise.all([refreshCampaign(), refreshStats()]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `failed to ${action}`);
    } finally {
      setActioning(false);
    }
  }

  if (!campaign) {
    return <p className="text-sm text-neutral-500">Loading…</p>;
  }

  const total = stats?.total ?? 0;
  const settled = (stats?.sent ?? 0) + (stats?.failed ?? 0) + (stats?.skipped ?? 0);
  const progressPct = total > 0 ? Math.round((settled / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-neutral-50">{campaign.name}</h1>
            <StatusBadge status={campaign.status} />
            {campaign.dryRun && (
              <span className="rounded-full border border-blue-800 bg-blue-950/50 px-2.5 py-0.5 text-xs text-blue-300">
                campaign: dry run
              </span>
            )}
            {!campaign.dryRun && (
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs ${
                  globallyDryRun
                    ? "border-amber-800 bg-amber-950/50 text-amber-300"
                    : "border-red-800 bg-red-950/50 text-red-300"
                }`}
                title={
                  globallyDryRun
                    ? "This campaign wants to send for real, but the system-wide switch (top-right badge) is still dry run — nothing will actually go out."
                    : "Both switches agree — this campaign will actually send."
                }
              >
                {globallyDryRun
                  ? "campaign: live, but system is dry run"
                  : "campaign: live — will actually send"}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-neutral-400">
            {campaign.ratePerMinute}/min · daily cap {campaign.dailyCap} · template #
            {campaign.templateId}
          </p>
        </div>
        <CampaignControls
          status={campaign.status}
          onStart={() => runAction("start")}
          onPause={() => runAction("pause")}
          onResume={() => runAction("resume")}
          disabled={actioning}
        />
      </div>

      {!campaign.dryRun && globallyDryRun && campaign.status === "draft" && (
        <Alert kind="warning">
          This campaign is set to send for real, but the{" "}
          <strong>system-wide send mode is still DRY RUN</strong> (see the
          badge in the top-right corner). Launching now will queue every
          recipient as usual, but the worker will skip all of them — nothing
          will actually be sent. Click the badge and confirm{" "}
          <span className="font-mono">SEND REAL EMAILS</span> first if you
          want this to actually deliver.
        </Alert>
      )}

      {!campaign.dryRun && globallyDryRun && campaign.status === "completed" && (
        <Alert kind="warning">
          This campaign finished with the system-wide send mode still on DRY
          RUN, so nothing it queued was actually sent — check the
          &quot;Skipped&quot; count below. Create a new campaign (campaigns
          aren&apos;t re-launchable) once you&apos;ve gone live.
        </Alert>
      )}

      {actionError && <Alert kind="error">{actionError}</Alert>}

      {lastResult && (
        <Alert kind="success">
          Launched: {lastResult.queued} queued
          {lastResult.alreadyQueued > 0 && `, ${lastResult.alreadyQueued} already queued`}
          {lastResult.renderErrors.length > 0 &&
            `, ${lastResult.renderErrors.length} skipped due to render errors`}
          .
        </Alert>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">Send progress</h2>
          {isActive && (
            <span className="flex items-center gap-1.5 text-xs text-blue-400">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
              </span>
              live — updating every {POLL_MS / 1000}s
            </span>
          )}
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {stats ? (
            <>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs text-neutral-500">
                  <span>
                    {settled} / {total} settled
                  </span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-600 to-emerald-500 transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                <StatCell label="Total" value={stats.total} />
                <StatCell label="Pending" value={stats.pending} />
                <StatCell label="Queued" value={stats.queued} tone="blue" />
                <StatCell label="Sent" value={stats.sent} tone="green" />
                <StatCell label="Failed" value={stats.failed} tone="red" />
                <StatCell label="Skipped" value={stats.skipped} tone="neutral" />
              </div>
            </>
          ) : (
            <p className="text-sm text-neutral-500">Loading stats…</p>
          )}
        </CardBody>
      </Card>

      <PreviewPanel campaignId={campaignId} />
    </div>
  );
}

function CampaignControls({
  status,
  onStart,
  onPause,
  onResume,
  disabled,
}: {
  status: Campaign["status"];
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  disabled: boolean;
}) {
  if (status === "draft") {
    return (
      <Button variant="primary" onClick={onStart} disabled={disabled}>
        Launch campaign
      </Button>
    );
  }
  if (status === "running") {
    return (
      <Button variant="ghost" onClick={onPause} disabled={disabled}>
        Pause
      </Button>
    );
  }
  if (status === "paused") {
    return (
      <div className="flex gap-2">
        <Button variant="primary" onClick={onResume} disabled={disabled}>
          Resume
        </Button>
        <span className="self-center text-xs text-amber-400">
          Paused — the worker will not send any queued job while paused.
        </span>
      </div>
    );
  }
  return (
    <Button variant="ghost" disabled>
      Completed
    </Button>
  );
}

function StatCell({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "blue" | "green" | "red";
}) {
  const toneClass = {
    neutral: "text-neutral-100",
    blue: "text-blue-300",
    green: "text-emerald-300",
    red: "text-red-300",
  }[tone];
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-center">
      <p className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
    </div>
  );
}

function PreviewPanel({ campaignId }: { campaignId: number }) {
  const { data: items, loading, error, refresh } = useApi<CampaignPreviewItem[]>(
    `/api/campaigns/${campaignId}/preview?limit=5`,
  );
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">
          Preview — first matching recipients
        </h2>
        <Button variant="ghost" onClick={() => refresh()} disabled={loading}>
          Refresh
        </Button>
      </CardHeader>
      <CardBody>
        {error && <Alert kind="error">{error}</Alert>}
        {!items && loading && <p className="text-sm text-neutral-500">Loading…</p>}
        {items && items.length === 0 && (
          <p className="text-sm text-neutral-500">
            No contacts match this campaign&apos;s filter.
          </p>
        )}
        <ul className="flex flex-col divide-y divide-neutral-800">
          {items?.map((item) => (
            <li key={item.to} className="py-2">
              <button
                onClick={() => setExpanded(expanded === item.to ? null : item.to)}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-neutral-100">{item.name}</p>
                  <p className="truncate text-xs text-neutral-500">{item.to}</p>
                </div>
                {item.ok ? (
                  <span className="shrink-0 text-xs text-emerald-400">renders OK</span>
                ) : (
                  <span className="shrink-0 text-xs text-red-400">render error</span>
                )}
              </button>
              {expanded === item.to && (
                <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950 p-3">
                  {item.ok ? (
                    <>
                      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                        Subject
                      </p>
                      <p className="mb-2 text-sm text-neutral-200">{item.subject}</p>
                      <pre className="whitespace-pre-wrap text-xs text-neutral-400">
                        {item.bodyText}
                      </pre>
                    </>
                  ) : (
                    <p className="text-xs text-red-400">{item.error}</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
