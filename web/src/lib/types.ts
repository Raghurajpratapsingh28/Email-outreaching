export type ContactStatus = "active" | "disabled" | "bounced";
export type ParseConfidence = "high" | "medium" | "low";

export interface Contact {
  id: number;
  sno: number | null;
  name: string;
  firstName: string;
  email: string;
  title: string | null;
  company: string | null;
  status: ContactStatus;
  confidence: ParseConfidence;
  source: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactListResponse {
  items: Contact[];
  total: number;
}

export interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CampaignStatus = "draft" | "running" | "paused" | "completed";

export interface ContactFilter {
  company?: string;
  confidence?: ParseConfidence;
  contactIds?: number[];
  /** Inclusive serial-number range, matching the PDF's original SNo column. */
  snoFrom?: number;
  snoTo?: number;
  limit?: number;
}

export interface Campaign {
  id: number;
  name: string;
  templateId: number;
  status: CampaignStatus;
  dryRun: boolean;
  ratePerMinute: number;
  dailyCap: number;
  contactFilter: ContactFilter | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CampaignStats {
  pending: number;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface CampaignPreviewItem {
  to: string;
  name: string;
  ok: boolean;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string | null;
  error?: string;
}

export interface ContactPreview {
  to: string;
  subject: string;
  text: string;
  html: string | null;
}

export interface StartCampaignResult {
  campaignId: number;
  recipients: number;
  queued: number;
  alreadyQueued: number;
  renderErrors: { contactId: number; email: string; error: string }[];
}

export interface ImportResult {
  totalRecords: number;
  successfullyParsed: number;
  imported: number;
  updated: number;
  duplicateEmails: number;
  invalidEmails: { sno: number; name: string; email: string; reason: string }[];
  incompleteRecords: { sno: number; name: string; email: string; missing: string[] }[];
  lowConfidence: { sno: number; name: string; title: string; company: string }[];
  skippedRecords: number;
  note?: string;
}

export type SendModeOverride = "live" | "dry_run" | null;

export interface SendModeStatus {
  effectiveDryRun: boolean;
  override: SendModeOverride;
  envDefault: boolean;
  liveExpiresInSeconds: number | null;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  dryRun: boolean;
  sendMode: SendModeStatus | null;
  database: boolean;
  redis: boolean;
}

export interface SuppressionEntry {
  id: number;
  email: string;
  reason: string | null;
  createdAt: string;
}
