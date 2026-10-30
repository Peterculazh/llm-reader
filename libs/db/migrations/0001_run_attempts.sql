ALTER TABLE "document_runs" ADD COLUMN "retryable" boolean;--> statement-breakpoint
ALTER TABLE "document_runs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;