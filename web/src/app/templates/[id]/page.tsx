import Link from "next/link";
import { notFound } from "next/navigation";
import { backend, BackendError } from "@/lib/backend";
import type { EmailTemplate } from "@/lib/types";
import { TemplateEditor } from "@/components/template-editor";
import { DeleteTemplateButton } from "./delete-button";

export default async function EditTemplatePage({
  params,
}: PageProps<"/templates/[id]">) {
  const { id } = await params;

  let template: EmailTemplate;
  try {
    template = await backend.get<EmailTemplate>(`/templates/${id}`);
  } catch (err) {
    if (err instanceof BackendError && err.status === 404) notFound();
    throw err;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/templates" className="text-xs text-blue-400 hover:text-blue-300">
            ← Templates
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-neutral-50">{template.name}</h1>
          <p className="mt-1 text-sm text-neutral-400">Template #{template.id}</p>
        </div>
        <DeleteTemplateButton templateId={template.id} />
      </div>
      <TemplateEditor mode="edit" initial={template} />
    </div>
  );
}
