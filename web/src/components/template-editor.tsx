"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Field, Input, Textarea, Alert } from "@/components/ui";
import { postJson, patchJson, useApi } from "@/lib/use-fetch";
import type { ContactListResponse, EmailTemplate } from "@/lib/types";

const VARIABLES: { key: string; desc: string }[] = [
  { key: "firstName", desc: 'First name — use in greetings. "Akanksha"' },
  { key: "name", desc: 'Full name. "Akanksha Puri" — not for greetings' },
  { key: "fullName", desc: "Alias of {{name}}" },
  { key: "title", desc: 'Job title. "Associate Director HR"' },
  { key: "company", desc: 'Company. "SourceFuse Technologies"' },
  { key: "email", desc: "The contact's own email address" },
];

interface Props {
  /** Only used at call sites to document intent — actual behavior branches on whether the template has been saved yet (`templateId === null`). */
  mode: "create" | "edit";
  initial?: EmailTemplate;
}

export function TemplateEditor({ initial }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [bodyText, setBodyText] = useState(initial?.bodyText ?? "");
  const [bodyHtml, setBodyHtml] = useState(initial?.bodyHtml ?? "");
  const [useHtml, setUseHtml] = useState(Boolean(initial?.bodyHtml));
  const [htmlOnly, setHtmlOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<number | null>(initial?.id ?? null);
  const [dirty, setDirty] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name,
        subject,
        // Sending "" (rather than omitting the key) tells the backend to
        // (re-)derive the plain-text body from bodyHtml — see resolveBodyText
        // in templates/service.ts. It always produces a real text part; the
        // send is never actually text-less.
        bodyText: htmlOnly ? "" : bodyText,
        bodyHtml: useHtml && bodyHtml.trim() ? bodyHtml : null,
      };
      if (templateId === null) {
        const created = await postJson<EmailTemplate>("/api/templates", payload);
        setTemplateId(created.id);
        setDirty(false);
        router.push(`/templates/${created.id}`);
      } else {
        await patchJson<EmailTemplate>(`/api/templates/${templateId}`, payload);
        setDirty(false);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save");
    } finally {
      setSaving(false);
    }
  }

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
      <div className="flex flex-col gap-4">
        {error && <Alert kind="error">{error}</Alert>}

        <Card>
          <CardBody className="flex flex-col gap-4">
            <Field label="Template name">
              <Input
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  markDirty(setName)(e.target.value)
                }
                placeholder="swe-outreach-v1"
              />
            </Field>
            <Field label="Subject" hint="Supports {{variables}} — see reference on the right.">
              <Input
                value={subject}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  markDirty(setSubject)(e.target.value)
                }
                placeholder="Software Engineering Opportunity — {{company}}"
              />
            </Field>
          </CardBody>
        </Card>

        {!htmlOnly && (
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-100">Plain-text body</h3>
              <span className="text-xs text-neutral-500">
                Required — used as the fallback for every send
              </span>
            </CardHeader>
            <CardBody>
              <Textarea
                rows={10}
                value={bodyText}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  markDirty(setBodyText)(e.target.value)
                }
                placeholder={"Dear {{firstName}},\n\nI came across {{company}} and wanted to reach out..."}
              />
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-100">HTML body</h3>
              <label className="flex items-center gap-2 text-xs text-neutral-400">
                <input
                  type="checkbox"
                  checked={useHtml}
                  onChange={(e) => {
                    markDirty(setUseHtml)(e.target.checked);
                    if (!e.target.checked) markDirty(setHtmlOnly)(false);
                  }}
                  className="h-3.5 w-3.5 rounded border-neutral-600 bg-neutral-900"
                />
                Send an HTML version too
              </label>
            </div>
            {useHtml && (
              <label className="flex items-center gap-2 text-xs text-neutral-400">
                <input
                  type="checkbox"
                  checked={htmlOnly}
                  onChange={(e) => markDirty(setHtmlOnly)(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-neutral-600 bg-neutral-900"
                />
                HTML only — auto-generate the plain-text fallback for me
              </label>
            )}
          </CardHeader>
          {useHtml && (
            <CardBody>
              <Textarea
                rows={12}
                value={bodyHtml}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  markDirty(setBodyHtml)(e.target.value)
                }
                placeholder={"<p>Dear {{firstName}},</p>\n<p>I came across <strong>{{company}}</strong>...</p>"}
              />
              <p className="mt-2 text-xs text-neutral-500">
                Raw HTML source. Each substituted value ({"{{firstName}}"}, {"{{company}}"}, etc.) is
                HTML-escaped automatically, but the surrounding markup you write here is sent as-is.
                {htmlOnly && (
                  <>
                    {" "}
                    The plain-text version every send still includes is generated
                    from this HTML automatically — every real client and every
                    spam filter still sees a text part, you just never write it.
                  </>
                )}
              </p>
            </CardBody>
          )}
        </Card>

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={
              saving ||
              !name ||
              !subject ||
              (htmlOnly ? !bodyHtml.trim() : !bodyText)
            }
          >
            {saving
              ? "Saving…"
              : templateId === null
                ? "Create template"
                : dirty
                  ? "Save changes"
                  : "Saved"}
          </Button>
          {templateId !== null && (
            <span className="text-xs text-neutral-500">
              Template #{templateId}
              {dirty && " · unsaved changes — preview below reflects the last saved version"}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <VariableReference />
        {templateId === null ? (
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-neutral-100">Live preview</h3>
            </CardHeader>
            <CardBody>
              <p className="text-xs text-neutral-500">
                Save the template first — the preview renders through the real
                backend engine against an actual contact, so it always matches
                what would be sent.
              </p>
            </CardBody>
          </Card>
        ) : (
          <SavedTemplatePreview templateId={templateId} stale={dirty} />
        )}
      </div>
    </div>
  );
}

function VariableReference() {
  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-neutral-100">Variables</h3>
      </CardHeader>
      <CardBody>
        <ul className="flex flex-col gap-2">
          {VARIABLES.map((v) => (
            <li key={v.key} className="text-xs">
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-blue-300">{`{{${v.key}}}`}</code>
              <p className="mt-1 text-neutral-400">{v.desc}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-neutral-500">
          Unknown variables are rejected on save. Empty {"{{title}}"}/{"{{company}}"} fail the
          send rather than going out broken — {"{{firstName}}"} is the only one with a safe
          fallback.
        </p>
      </CardBody>
    </Card>
  );
}

/**
 * Renders a saved template against a real contact via the backend's own
 * render engine (POST /templates/:id/preview) — this is exactly the code
 * path used at campaign launch time, so what's shown here is guaranteed to
 * match what a recipient would actually receive. No client-side
 * re-implementation of the substitution logic exists anywhere in this app.
 */
function SavedTemplatePreview({ templateId, stale }: { templateId: number; stale: boolean }) {
  const { data: contactPage } = useApi<ContactListResponse>("/api/contacts?limit=50");
  const [contactId, setContactId] = useState<number | "">("");
  const [rendered, setRendered] = useState<{
    to: string;
    subject: string;
    text: string;
    html: string | null;
  } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [tab, setTab] = useState<"text" | "html">("text");

  const contacts = useMemo(() => contactPage?.items ?? [], [contactPage]);

  async function runPreview(id: number) {
    setRendering(true);
    setRenderError(null);
    setRendered(null);
    try {
      const result = await postJson<{
        to: string;
        contact: string;
        subject: string;
        bodyText: string;
        bodyHtml: string | null;
      }>(`/api/templates/${templateId}/preview`, { contactId: id });
      setRendered({
        to: result.to,
        subject: result.subject,
        text: result.bodyText,
        html: result.bodyHtml,
      });
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : "preview failed");
    } finally {
      setRendering(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-100">Live preview</h3>
        {stale && (
          <span className="text-xs text-amber-400">unsaved changes not reflected</span>
        )}
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <Field label="Preview against contact">
          <select
            value={contactId}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : "";
              setContactId(id);
              if (id) void runPreview(id);
            }}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          >
            <option value="">Select a contact…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.company || "no company"}
              </option>
            ))}
          </select>
        </Field>

        {renderError && <Alert kind="error">{renderError}</Alert>}

        {rendering && <p className="text-xs text-neutral-500">Rendering…</p>}

        {rendered && !rendering && (
          <div className="flex flex-col gap-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                To / Subject
              </p>
              <p className="mt-0.5 text-sm text-neutral-100">{rendered.to}</p>
              <p className="text-sm text-neutral-300">{rendered.subject}</p>
            </div>

            {rendered.html && (
              <div className="flex gap-1 border-b border-neutral-800">
                <TabButton active={tab === "text"} onClick={() => setTab("text")}>
                  Plain text
                </TabButton>
                <TabButton active={tab === "html"} onClick={() => setTab("html")}>
                  HTML rendered
                </TabButton>
              </div>
            )}

            {tab === "text" || !rendered.html ? (
              <pre className="whitespace-pre-wrap rounded-md bg-neutral-950 p-3 text-xs text-neutral-300 border border-neutral-800">
                {rendered.text}
              </pre>
            ) : (
              <iframe
                title="HTML preview"
                sandbox=""
                className="h-64 w-full rounded-md border border-neutral-800 bg-white"
                srcDoc={rendered.html}
              />
            )}
          </div>
        )}

        {!rendered && !rendering && !renderError && (
          <p className="text-xs text-neutral-500">
            Pick a contact above to see the exact rendered email, straight
            from the backend&apos;s render engine.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-blue-500 text-blue-300"
          : "border-transparent text-neutral-500 hover:text-neutral-300"
      }`}
    >
      {children}
    </button>
  );
}
