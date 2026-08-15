"use client";

import Link from "next/link";
import { useApi } from "@/lib/use-fetch";
import type { EmailTemplate } from "@/lib/types";
import { Button, Card, CardBody, EmptyState, Spinner } from "@/components/ui";

export default function TemplatesPage() {
  const { data: templates, loading } = useApi<EmailTemplate[]>("/api/templates");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-50">Templates</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Subject/body pairs with {"{{variables}}"}, reused across campaigns.
          </p>
        </div>
        <Link href="/templates/new">
          <Button variant="primary">New template</Button>
        </Link>
      </div>

      <Card>
        <CardBody>
          {loading && !templates ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : !templates || templates.length === 0 ? (
            <EmptyState
              title="No templates yet"
              subtitle="Create one to start building a campaign."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-800">
              {templates.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/templates/${t.id}`}
                    className="flex items-center justify-between gap-3 py-3 hover:bg-neutral-800/40 -mx-2 px-2 rounded-md"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-neutral-100">
                        {t.name}
                      </p>
                      <p className="truncate text-xs text-neutral-500">{t.subject}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {t.bodyHtml && (
                        <span className="rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
                          HTML
                        </span>
                      )}
                      <span className="text-xs text-neutral-600">#{t.id}</span>
                    </div>
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
