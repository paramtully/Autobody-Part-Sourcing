UPDATE "part_identifiers"
SET "value" = upper(replace(btrim("value"), '-', ''))
WHERE "value" <> upper(replace(btrim("value"), '-', ''));--> statement-breakpoint
ALTER TABLE "part_identifiers" ADD CONSTRAINT "part_identifiers_value_format_check" CHECK ("value" = upper("value") AND "value" NOT LIKE '%-%' AND "value" = btrim("value") AND length("value") > 0);
