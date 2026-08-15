"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export function DeleteTemplateButton({ templateId }: { templateId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${templateId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(
          (body && typeof body === "object" && "error" in body
            ? String((body as { error: unknown }).error)
            : undefined) ?? "delete failed — it may be in use by a campaign",
        );
      }
      router.push("/templates");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
      setDeleting(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        {error && <span className="text-xs text-red-400">{error}</span>}
        <Button variant="ghost" onClick={() => setConfirming(false)} disabled={deleting}>
          Cancel
        </Button>
        <Button variant="danger" onClick={handleDelete} disabled={deleting}>
          {deleting ? "Deleting…" : "Confirm delete"}
        </Button>
      </div>
    );
  }

  return (
    <Button variant="ghost" onClick={() => setConfirming(true)}>
      Delete
    </Button>
  );
}
