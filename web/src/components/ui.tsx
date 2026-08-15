import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-neutral-800 bg-neutral-900/50 ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border-b border-neutral-800 px-5 py-4 ${className}`}>
      {children}
    </div>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}

const VARIANT_CLASSES = {
  primary:
    "bg-blue-600 hover:bg-blue-500 text-white disabled:bg-blue-900 disabled:text-blue-300/50",
  danger:
    "bg-red-600 hover:bg-red-500 text-white disabled:bg-red-950 disabled:text-red-300/50",
  ghost:
    "bg-transparent hover:bg-neutral-800 text-neutral-200 border border-neutral-700 disabled:text-neutral-600",
  subtle:
    "bg-neutral-800 hover:bg-neutral-700 text-neutral-100 disabled:bg-neutral-900 disabled:text-neutral-600",
} as const;

export function Button({
  variant = "subtle",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANT_CLASSES;
}) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

const STATUS_CLASSES: Record<string, string> = {
  draft: "bg-neutral-800 text-neutral-300 border-neutral-700",
  running: "bg-blue-950/60 text-blue-300 border-blue-800",
  paused: "bg-amber-950/60 text-amber-300 border-amber-800",
  completed: "bg-emerald-950/60 text-emerald-300 border-emerald-800",
  active: "bg-emerald-950/60 text-emerald-300 border-emerald-800",
  disabled: "bg-neutral-800 text-neutral-400 border-neutral-700",
  bounced: "bg-red-950/60 text-red-300 border-red-800",
  high: "bg-emerald-950/60 text-emerald-300 border-emerald-800",
  medium: "bg-amber-950/60 text-amber-300 border-amber-800",
  low: "bg-red-950/60 text-red-300 border-red-800",
  sent: "bg-emerald-950/60 text-emerald-300 border-emerald-800",
  failed: "bg-red-950/60 text-red-300 border-red-800",
  skipped: "bg-neutral-800 text-neutral-400 border-neutral-700",
  queued: "bg-blue-950/60 text-blue-300 border-blue-800",
  pending: "bg-neutral-800 text-neutral-300 border-neutral-700",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_CLASSES[status] ?? "bg-neutral-800 text-neutral-300 border-neutral-700";
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${cls}`}
    >
      {status}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-neutral-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

export function Input(props: HTMLAttributes<HTMLInputElement> & { [key: string]: unknown }) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 ${(props.className as string) ?? ""}`}
    />
  );
}

export function Textarea(
  props: HTMLAttributes<HTMLTextAreaElement> & { [key: string]: unknown },
) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 ${(props.className as string) ?? ""}`}
    />
  );
}

export function Alert({
  kind = "info",
  children,
}: {
  kind?: "info" | "error" | "success" | "warning";
  children: ReactNode;
}) {
  const cls = {
    info: "border-blue-800 bg-blue-950/40 text-blue-200",
    error: "border-red-800 bg-red-950/40 text-red-200",
    success: "border-emerald-800 bg-emerald-950/40 text-emerald-200",
    warning: "border-amber-800 bg-amber-950/40 text-amber-200",
  }[kind];
  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${cls}`}>{children}</div>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-16 text-center">
      <p className="text-sm font-medium text-neutral-300">{title}</p>
      {subtitle && <p className="text-sm text-neutral-500">{subtitle}</p>}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-100 ${className}`}
    />
  );
}
