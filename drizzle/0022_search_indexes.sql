-- Arabic-insensitive search: أ/إ/آ → ا, ة → ه, ى → ي, drop tatweel and short vowels (tashkeel).
-- IMMUTABLE so it can back expression indexes. Trigram indexes make partial matches fast.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pm_normalize_ar(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT AS $$
  SELECT lower(translate(t, 'أإآةىـًٌٍَُِّْ', 'اااهي'))
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customers_name_trgm ON customers USING gin (pm_normalize_ar(name) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customers_phone_trgm ON customers USING gin (phone_e164 gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customer_addresses_district_trgm ON customer_addresses USING gin (pm_normalize_ar(district) gin_trgm_ops);
