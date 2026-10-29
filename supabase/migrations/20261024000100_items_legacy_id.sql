-- Mon Dressing : import du prototype rejouable sans doublon (docs/conception.md §3.1).
-- Ajoute l'id de la pièce dans le prototype. Migration additive : rien n'est supprimé.
-- À coller dans Supabase > SQL Editor, puis « Run ». Le script peut être relancé sans dommage.

alter table public.items add column if not exists legacy_id text
  check (legacy_id is null or char_length(legacy_id) between 1 and 64);

-- Unique par compte. Plusieurs pièces sans legacy_id (null) restent possibles.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_owner_legacy_id_key') then
    alter table public.items add constraint items_owner_legacy_id_key unique (owner, legacy_id);
  end if;
end $$;
