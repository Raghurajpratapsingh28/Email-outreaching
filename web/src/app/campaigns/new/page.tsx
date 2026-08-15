"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApi, postJson } from "@/lib/use-fetch";
import type { Campaign, ContactListResponse, EmailTemplate } from "@/lib/types";
import { Alert, Button, Card, CardBody, Field, Input } from "@/components/ui";

export default function NewCampaignPage() {
  const router = useRouter();
  const { data: templates } = useApi<EmailTemplate[]>("/api/templates");

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<number | "">("");
  const [company, setCompany] = useState("");
  const [confidence, setConfidence] = useState<"" | "high" | "medium" | "low">("");
  const [snoFrom, setSnoFrom] = useState("");
  const [snoTo, setSnoTo] = useState("");
  const [limit, setLimit] = useState(50);
  const [dryRun, setDryRun] = useState(true);
  const [ratePerMinute, setRatePerMinute] = useState(20);
  const [dailyCap, setDailyCap] = useState(400);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matchParams = new URLSearchParams();
  if (company.trim()) matchParams.set("company", company.trim());
  if (confidence) matchParams.set("confidence", confidence);
  if (snoFrom) matchParams.set("snoFrom", snoFrom);
  if (snoTo) matchParams.set("snoTo", snoTo);
  matchParams.set("status", "active");
  matchParams.set("limit", "1");
  const { data: matchPreview } = useApi<ContactListResponse>(
    `/api/contacts?${matchParams.toString()}`,
  );

  async function handleCreate() {
    if (!templateId) {
      setError("choose a template");
      return;
    }
    if (snoFrom && snoTo && Number(snoFrom) > Number(snoTo)) {
      setError("serial-number range: 'from' must be less than or equal to 'to'");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const contactFilter: Record<string, unknown> = { limit };
      if (company.trim()) contactFilter.company = company.trim();
      if (confidence) contactFilter.confidence = confidence;
      if (snoFrom) contactFilter.snoFrom = Number(snoFrom);
      if (snoTo) contactFilter.snoTo = Number(snoTo);

      const campaign = await postJson<Campaign>("/api/campaigns", {
        name,
        templateId,
        contactFilter,
        dryRun,
        ratePerMinute,
        dailyCap,
      });
      router.push(`/campaigns/${campaign.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create campaign");
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link href="/campaigns" className="text-xs text-blue-400 hover:text-blue-300">
          ← Campaigns
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-50">New campaign</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Creating a campaign never sends anything by itself — you preview and
          explicitly launch it afterward.
        </p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <Card>
        <CardBody className="flex flex-col gap-4">
          <Field label="Campaign name">
            <Input
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              placeholder="swe-outreach-batch-1"
            />
          </Field>

          <Field label="Template">
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : "")}
              className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            >
              <option value="">Select a template…</option>
              {templates?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {templates && templates.length === 0 && (
              <p className="mt-1 text-xs text-amber-400">
                No templates yet —{" "}
                <Link href="/templates/new" className="underline">
                  create one first
                </Link>
                .
              </p>
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-neutral-100">Recipient filter</h3>
          <p className="text-xs text-neutral-500">
            Only active, non-suppressed contacts are ever selected — filters
            narrow further, they never override that.
          </p>

          <Field
            label="Serial No. range"
            hint="Matches the SNo column from the original PDF — e.g. send only SNo 100 through 200. Sent in ascending SNo order."
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                placeholder="from"
                value={snoFrom}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSnoFrom(e.target.value)}
                className="w-28"
              />
              <span className="text-sm text-neutral-500">to</span>
              <Input
                type="number"
                min={1}
                placeholder="to"
                value={snoTo}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSnoTo(e.target.value)}
                className="w-28"
              />
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Company contains" hint="optional">
              <Input
                value={company}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCompany(e.target.value)}
                placeholder="e.g. Tech"
              />
            </Field>
            <Field label="Parse confidence" hint="optional">
              <select
                value={confidence}
                onChange={(e) => setConfidence(e.target.value as typeof confidence)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              >
                <option value="">Any</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </Field>
          </div>
          <Field label="Max recipients" hint="Caps how many contacts this campaign will ever target.">
            <Input
              type="number"
              min={1}
              max={5000}
              value={limit}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLimit(Number(e.target.value))}
            />
          </Field>

          {matchPreview !== null && (
            <p className="text-xs text-neutral-400">
              <span className="font-medium text-neutral-200">{matchPreview?.total ?? "…"}</span>{" "}
              active, non-suppressed contact{matchPreview?.total === 1 ? "" : "s"} currently match
              this filter (before the max-recipients cap above).
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-neutral-100">Send settings</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Rate (emails/minute)">
              <Input
                type="number"
                min={1}
                max={60}
                value={ratePerMinute}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setRatePerMinute(Number(e.target.value))
                }
              />
            </Field>
            <Field label="Daily cap">
              <Input
                type="number"
                min={1}
                max={500}
                value={dailyCap}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDailyCap(Number(e.target.value))}
              />
            </Field>
          </div>
          <label className="flex items-start gap-3 rounded-md border border-neutral-800 bg-neutral-950 p-3">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-neutral-600 bg-neutral-900"
            />
            <span className="text-sm">
              <span className="font-medium text-neutral-100">Dry run</span>
              <p className="text-xs text-neutral-500">
                Recommended for a new campaign. Every send is intercepted before
                SMTP and logged instead — nothing reaches a real inbox. Even
                with this off, the server-wide <code>DRY_RUN</code> setting
                still overrides it.
              </p>
            </span>
          </label>
        </CardBody>
      </Card>

      <div>
        <Button
          variant="primary"
          onClick={handleCreate}
          disabled={saving || !name || !templateId}
        >
          {saving ? "Creating…" : "Create campaign"}
        </Button>
      </div>
    </div>
  );
}
