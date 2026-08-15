import Link from "next/link";
import { TemplateEditor } from "@/components/template-editor";

export default function NewTemplatePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/templates" className="text-xs text-blue-400 hover:text-blue-300">
          ← Templates
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-50">New template</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Write your subject and body with {"{{variables}}"}. Save to unlock a live
          preview against a real contact.
        </p>
      </div>
      <TemplateEditor mode="create" />
    </div>
  );
}
