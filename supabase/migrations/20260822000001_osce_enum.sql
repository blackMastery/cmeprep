-- OSCE part 1/2: the enum value ALONE. ALTER TYPE ... ADD VALUE is legal
-- inside a transaction on PG >= 12, but the new value cannot be USED in the
-- same transaction — and 20260822000002 creates a view that filters on it.
-- Each migration file runs in its own transaction, so the split is load-bearing.
alter type question_type add value 'osce';
