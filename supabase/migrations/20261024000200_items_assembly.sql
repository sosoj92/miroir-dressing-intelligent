-- Mon Dressing : repères d'assemblage des photos portées (docs/conception.md §7, §3.2).
-- Migration additive : rien n'est supprimé. Le script peut être relancé sans dommage.

alter table public.items add column if not exists assembly jsonb
  check (assembly is null or jsonb_typeof(assembly) = 'object');
