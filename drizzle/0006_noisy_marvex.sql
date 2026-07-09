ALTER TABLE "asset_snapshots" DROP CONSTRAINT "asset_snapshots_asset_type_check";--> statement-breakpoint
ALTER TABLE "asset_snapshots" ADD CONSTRAINT "asset_snapshots_asset_type_check" CHECK ("asset_snapshots"."asset_type" in ('cash', 'crypto', 'stock', 'fund', 'cfd'));--> statement-breakpoint
UPDATE "asset_snapshots"
SET
  "asset_type" = 'cfd',
  "asset_key" = 'bitflyer:cfd_account:cfd:JPY:unrealized_pnl'
WHERE "asset_key" = 'bitflyer:cfd_account:cash:JPY:unrealized_pnl'
  AND "asset_type" = 'cash';
