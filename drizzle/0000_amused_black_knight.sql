CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'running', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('active', 'disabled', 'bounced');--> statement-breakpoint
CREATE TYPE "public"."email_event_type" AS ENUM('queued', 'sent', 'failed', 'retried', 'skipped', 'dry_run');--> statement-breakpoint
CREATE TYPE "public"."email_job_status" AS ENUM('pending', 'queued', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."parse_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"template_id" integer NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"rate_per_minute" integer DEFAULT 20 NOT NULL,
	"daily_cap" integer DEFAULT 400 NOT NULL,
	"contact_filter" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"sno" integer,
	"name" text NOT NULL,
	"first_name" text NOT NULL,
	"email" text NOT NULL,
	"title" text,
	"company" text,
	"status" "contact_status" DEFAULT 'active' NOT NULL,
	"confidence" "parse_confidence" DEFAULT 'high' NOT NULL,
	"source" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_job_id" integer NOT NULL,
	"type" "email_event_type" NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"contact_id" integer NOT NULL,
	"status" "email_job_status" DEFAULT 'pending' NOT NULL,
	"to_email" text NOT NULL,
	"rendered_subject" text NOT NULL,
	"rendered_body_text" text NOT NULL,
	"rendered_body_html" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"body_html" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_email_job_id_email_jobs_id_fk" FOREIGN KEY ("email_job_id") REFERENCES "public"."email_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_email_unique" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "contacts_status_idx" ON "contacts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contacts_company_idx" ON "contacts" USING btree ("company");--> statement-breakpoint
CREATE INDEX "email_events_job_idx" ON "email_events" USING btree ("email_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_jobs_campaign_contact_unique" ON "email_jobs" USING btree ("campaign_id","contact_id");--> statement-breakpoint
CREATE INDEX "email_jobs_status_idx" ON "email_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_jobs_campaign_status_idx" ON "email_jobs" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_name_unique" ON "email_templates" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "suppression_list_email_unique" ON "suppression_list" USING btree ("email");