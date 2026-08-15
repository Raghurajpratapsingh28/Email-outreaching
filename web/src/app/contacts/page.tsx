"use client";

import { useState } from "react";
import { useApi } from "@/lib/use-fetch";
import type { ContactListResponse } from "@/lib/types";
import { Card, CardBody, EmptyState, Input, Spinner, StatusBadge } from "@/components/ui";
import { PdfImport } from "@/components/pdf-import";

const PAGE_SIZE = 25;

export default function ContactsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [confidence, setConfidence] = useState("");
  const [snoFrom, setSnoFrom] = useState("");
  const [snoTo, setSnoTo] = useState("");
  const [page, setPage] = useState(0);
  const [importOpen, setImportOpen] = useState(false);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (confidence) params.set("confidence", confidence);
  if (snoFrom) params.set("snoFrom", snoFrom);
  if (snoTo) params.set("snoTo", snoTo);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));

  const { data, loading, error, refresh } = useApi<ContactListResponse>(
    `/api/contacts?${params.toString()}`,
  );

  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(0);
    };
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const snoRangeActive = snoFrom !== "" || snoTo !== "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-50">Contacts</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {data ? `${data.total} total` : "Loading…"}
          </p>
        </div>
        <button
          onClick={() => setImportOpen((v) => !v)}
          className="rounded-md border border-neutral-700 px-3.5 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-800"
        >
          {importOpen ? "Hide import" : "Import PDF"}
        </button>
      </div>

      {importOpen && (
        <PdfImport
          onImported={() => {
            setPage(0);
            refresh();
          }}
        />
      )}

      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Search name, email, company, title…"
                value={q}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  updateFilter(setQ)(e.target.value)
                }
              />
            </div>
            <select
              value={status}
              onChange={(e) => updateFilter(setStatus)(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            >
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
              <option value="bounced">Bounced</option>
            </select>
            <select
              value={confidence}
              onChange={(e) => updateFilter(setConfidence)(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            >
              <option value="">Any confidence</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3">
            <span className="text-xs font-medium text-neutral-400">Serial No. range</span>
            <Input
              type="number"
              min={1}
              placeholder="from"
              value={snoFrom}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateFilter(setSnoFrom)(e.target.value)
              }
              className="w-24"
            />
            <span className="text-xs text-neutral-500">to</span>
            <Input
              type="number"
              min={1}
              placeholder="to"
              value={snoTo}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateFilter(setSnoTo)(e.target.value)
              }
              className="w-24"
            />
            {snoRangeActive && (
              <button
                onClick={() => {
                  setSnoFrom("");
                  setSnoTo("");
                  setPage(0);
                }}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Clear range
              </button>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          {error && (
            <p className="pb-3 text-sm text-red-400">{error}</p>
          )}
          {loading && !data ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : !data || data.items.length === 0 ? (
            <EmptyState title="No contacts match" subtitle="Try clearing filters, or import a PDF." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 text-xs uppercase tracking-wide text-neutral-500">
                    <th className="pb-2 pr-4 font-medium">SNo</th>
                    <th className="pb-2 pr-4 font-medium">Name</th>
                    <th className="pb-2 pr-4 font-medium">Email</th>
                    <th className="pb-2 pr-4 font-medium">Title</th>
                    <th className="pb-2 pr-4 font-medium">Company</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium">Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {data.items.map((c) => (
                    <tr key={c.id} className="text-neutral-200">
                      <td className="py-2 pr-4 tabular-nums text-neutral-500">{c.sno ?? "—"}</td>
                      <td className="py-2 pr-4">{c.name}</td>
                      <td className="py-2 pr-4 text-neutral-400">{c.email}</td>
                      <td className="py-2 pr-4 text-neutral-400">{c.title || "—"}</td>
                      <td className="py-2 pr-4 text-neutral-400">{c.company || "—"}</td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="py-2">
                        <StatusBadge status={c.confidence} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-xs text-neutral-500">
              <span>
                Page {page + 1} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded-md border border-neutral-700 px-2.5 py-1 disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="rounded-md border border-neutral-700 px-2.5 py-1 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
