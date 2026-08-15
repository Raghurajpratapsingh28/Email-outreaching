"use client";

import Link from "next/link";
import { useApi } from "@/lib/use-fetch";
import type { Campaign } from "@/lib/types";
import { Button, Card, CardBody, EmptyState, Spinner, StatusBadge } from "@/components/ui";

export default function CampaignsPage() {
  const { data: campaigns, loading } = useApi<Campaign[]>("/api/campaigns", 5000);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-50">Campaigns</h1>
          <p className="mt-1 text-sm text-neutral-400">
            A template applied to a filtered set of contacts.
          </p>
        </div>
        <Link href="/campaigns/new">
          <Button variant="primary">New campaign</Button>
        </Link>
      </div>

      <Card>
        <CardBody>
          {loading && !campaigns ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : !campaigns || campaigns.length === 0 ? (
            <EmptyState
              title="No campaigns yet"
              subtitle="Create a template first, then build a campaign around it."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-800">
              {campaigns.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/campaigns/${c.id}`}
                    className="flex items-center justify-between gap-3 py-3 hover:bg-neutral-800/40 -mx-2 px-2 rounded-md"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-neutral-100">
                        {c.name}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {c.dryRun ? "dry run" : "live"} · {c.ratePerMinute}/min · daily cap {c.dailyCap}
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
