CREATE TABLE "asset_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_observation_id" uuid NOT NULL,
	"asset_key" text NOT NULL,
	"asset_type" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text,
	"quantity" numeric(38, 18) NOT NULL,
	"price" numeric(38, 18) NOT NULL,
	"price_currency" text NOT NULL,
	"fx_to_jpy" numeric(38, 18) NOT NULL,
	"value_jpy" numeric(38, 18) NOT NULL,
	"raw" jsonb,
	CONSTRAINT "asset_snapshots_asset_type_check" CHECK ("asset_snapshots"."asset_type" in ('cash', 'crypto', 'stock', 'fund'))
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_account_id" uuid NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"metadata" jsonb,
	CONSTRAINT "ingestion_runs_status_check" CHECK ("ingestion_runs"."status" in ('running', 'success', 'partial', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "observation_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_account_id" uuid NOT NULL,
	"scope_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observation_scopes_status_check" CHECK ("observation_scopes"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "scope_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingestion_run_id" uuid NOT NULL,
	"observation_scope_id" uuid NOT NULL,
	"status" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"data_as_of" timestamp with time zone,
	"error_code" text,
	"raw_error_code" text,
	"error_message" text,
	"retryable" boolean,
	"metadata" jsonb,
	CONSTRAINT "scope_observations_status_check" CHECK ("scope_observations"."status" in ('success', 'partial', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "source_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_accounts_status_check" CHECK ("source_accounts"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "asset_snapshots" ADD CONSTRAINT "asset_snapshots_scope_observation_id_scope_observations_id_fk" FOREIGN KEY ("scope_observation_id") REFERENCES "public"."scope_observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_source_account_id_source_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_scopes" ADD CONSTRAINT "observation_scopes_source_account_id_source_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_observations" ADD CONSTRAINT "scope_observations_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_observations" ADD CONSTRAINT "scope_observations_observation_scope_id_observation_scopes_id_fk" FOREIGN KEY ("observation_scope_id") REFERENCES "public"."observation_scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_snapshots_observation_asset_idx" ON "asset_snapshots" USING btree ("scope_observation_id","asset_key");--> statement-breakpoint
CREATE INDEX "ingestion_runs_source_started_idx" ON "ingestion_runs" USING btree ("source_account_id","started_at");--> statement-breakpoint
CREATE INDEX "observation_scopes_scope_id_idx" ON "observation_scopes" USING btree ("scope_id");--> statement-breakpoint
CREATE INDEX "scope_observations_scope_observed_idx" ON "scope_observations" USING btree ("observation_scope_id","observed_at");