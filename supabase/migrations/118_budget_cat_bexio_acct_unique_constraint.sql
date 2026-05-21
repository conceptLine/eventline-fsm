-- Hotfix: budget_cat_bexio_acct_unique vom Partial-Index zur regulaeren
-- Unique-Constraint umbauen.
--
-- Hintergrund: Migration 116 hat den Index als PARTIAL angelegt
-- (WHERE bexio_account_no IS NOT NULL) — vermeintlich nuetzlich um
-- multiple NULL-Werte zu erlauben. Postgres erlaubt mehrere NULLs in
-- regulaeren UNIQUE-Constraints aber sowieso (NULL ist nicht gleich
-- NULL). Das Partial war ueberfluessig.
--
-- Schwerwiegender: Partial-Indexes sind KEIN gueltiges ON-CONFLICT-Target.
-- Postgres antwortet: "there is no unique or exclusion constraint matching
-- the ON CONFLICT specification". Folge: syncBexioAccountsToBudgetCategories
-- konnte NICHT einen einzigen Konto-Datensatz upserten — alle 64 expense-
-- Konten landeten im skipped-Counter. UI zeigte "0 Konten" trotz funktionie-
-- render API-Antwort.

drop index if exists public.budget_cat_bexio_acct_unique;

alter table public.budget_categories
  add constraint budget_cat_bexio_acct_unique unique (bexio_account_no);
