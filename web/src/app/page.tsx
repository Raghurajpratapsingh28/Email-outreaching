"use client";

import Link from "next/link";
import { useApi } from "@/lib/use-fetch";
import type { Campaign, ContactListResponse, EmailTemplate } from "@/lib/types";
import { Card, CardBody, CardHeader, StatusBadge, EmptyState, Spinner } from "@/components/ui";

export default function DashboardPage() {
  const { data: campaigns, loading: campaignsLoading } = useApi<Campaign[]>(
    "/api/campaigns",
    5000,
  );
  const { data: templates } = useApi<EmailTemplate[]>("/api/templates");
  const { data: contacts } = useApi<ContactListResponse>("/api/contacts?limit=1");

  const running = campaigns?.filter((c) => c.status === "running") ?? [];
  const recent = campaigns?.slice(0, 8) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-50">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Overview of contacts, templates, and campaign activity.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Contacts" value={contacts?.total} href="/contacts" />
        <StatTile label="Templates" value={templates?.length} href="/templates" />
        <StatTile label="Campaigns" value={campaigns?.length} href="/campaigns" />
      </div>

      {running.length > 0 && (
        <Card className="border-blue-800">
          <CardHeader className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
            </span>
            <h2 className="text-sm font-semibold text-neutral-100">
              {running.length} campaign{running.length > 1 ? "s" : ""} sending right now
            </h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {running.map((c) => (
              <Link
                key={c.id}
                href={`/campaigns/${c.id}`}
                className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-neutral-800/60"
              >
                <span className="text-sm text-neutral-200">{c.name}</span>
                <StatusBadge status={c.status} />
              </Link>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">Recent campaigns</h2>
          <Link href="/campaigns" className="text-xs text-blue-400 hover:text-blue-300">
            View all →
          </Link>
        </CardHeader>
        <CardBody>
          {campaignsLoading && !campaigns ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              title="No campaigns yet"
              subtitle="Create a template, then a campaign, to get started."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-800">
              {recent.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/campaigns/${c.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 hover:bg-neutral-800/40 -mx-2 px-2 rounded-md"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-neutral-100">{c.name}</p>
                      <p className="text-xs text-neutral-500">
                        {c.dryRun ? "dry run" : "live"} · {c.ratePerMinute}/min
                      </p>
                    </div>
                    <StatusBadge status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function StatTile({
  label,
  value,
  href,
}: {
  label: string;
  value: number | undefined;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="hover:border-neutral-700 transition-colors">
        <CardBody>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold text-neutral-50">
            {value ?? "—"}
          </p>
        </CardBody>
      </Card>
    </Link>
  );
}
