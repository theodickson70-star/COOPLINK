-- Jina la kampuni: NAYA GROUP -> DUKALANGU SOLUTION (wasifu wa biashara tu; data nyingine haiguswi)
UPDATE "platform_settings"
SET "value" = jsonb_set("value", '{companyName}', '"DUKALANGU SOLUTION"'), "updated_at" = now()
WHERE "key" = 'business.profile' AND upper(trim("value"->>'companyName')) IN ('NAYA GROUP', 'NAYA');
