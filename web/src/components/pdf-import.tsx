"use client";

import { useRef, useState } from "react";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui";
import type { ImportResult } from "@/lib/types";

export function PdfImport({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/contacts/import", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "import failed");
      setResult(body as ImportResult);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "import failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-neutral-100">Import contacts from PDF</h2>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-neutral-700 bg-neutral-950 px-4 py-8 text-center hover:border-neutral-600">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <span className="text-sm text-neutral-300">
            {uploading ? "Importing…" : "Click to choose a PDF, or drop one here"}
          </span>
          <span className="text-xs text-neutral-500">
            Re-running the same file is safe — matched and updated by email.
          </span>
        </label>

        {error && <Alert kind="error">{error}</Alert>}

        {result && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <ResultCell label="Records found" value={result.totalRecords} />
            <ResultCell label="Parsed" value={result.successfullyParsed} tone="green" />
            <ResultCell label="Inserted" value={result.imported} tone="green" />
            <ResultCell label="Updated" value={result.updated} tone="blue" />
            <ResultCell label="Duplicates" value={result.duplicateEmails} />
            <ResultCell
              label="Invalid emails"
              value={result.invalidEmails.length}
              tone={result.invalidEmails.length > 0 ? "red" : undefined}
            />
            <ResultCell
              label="Incomplete"
              value={result.incompleteRecords.length}
              tone={result.incompleteRecords.length > 0 ? "amber" : undefined}
            />
            <ResultCell
              label="Low confidence"
              value={result.lowConfidence.length}
              tone={result.lowConfidence.length > 0 ? "amber" : undefined}
            />
            <ResultCell label="Skipped lines" value={result.skippedRecords} />
          </div>
        )}

        {result && result.lowConfidence.length > 0 && (
          <p className="text-xs text-amber-400">
            {result.lowConfidence.length} contacts have a title/company split
            that couldn&apos;t be verified against the email domain — review
            them with the &quot;low&quot; confidence filter below before
            emailing them.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function ResultCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "green" | "blue" | "red" | "amber";
}) {
  const toneClass = tone
    ? {
        green: "text-emerald-300",
        blue: "text-blue-300",
        red: "text-red-300",
        amber: "text-amber-300",
      }[tone]
    : "text-neutral-100";
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-center">
      <p className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
    </div>
  );
}

