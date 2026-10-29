-- Mon Dressing : droits de la Data API sur les tables (docs/conception.md §3).
-- Un projet Supabase créé depuis le 30 mai 2026 n'expose plus d'office les nouvelles tables de
-- `public` à la Data API (case « Automatically expose new tables » décochée par défaut), et la règle
-- s'étend aux projets existants le 30 octobre 2026. Sans ces droits, chaque lecture de l'app répond
-- « permission denied » (42501). Seul le compte connecté (rôle authenticated) les reçoit : RLS limite
-- toujours chaque ligne à son propriétaire. Ni anon ni service_role : l'app ne s'en sert pas. Les clés
-- sont des uuid (gen_random_uuid()) : aucune séquence à ouvrir.
-- Migration additive : rien n'est supprimé. Le script peut être relancé sans dommage.

grant usage on schema public to authenticated;

grant select, insert, update, delete on table
  public.items,
  public.outfit_history,
  public.outfit_plans,
  public.refusals,
  public.profile,
  public.tryon_cache,
  public.spend_ledger
to authenticated;
