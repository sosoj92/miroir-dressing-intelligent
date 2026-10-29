// Configuration publique de Supabase, lisible côté navigateur et côté serveur.
// Next.js ne remplace que les lectures littérales `process.env.NEXT_PUBLIC_…` : ne les écris jamais
// sous la forme `process.env[nom]` ni par déstructuration (AGENTS.md).
// Ces deux valeurs sont recopiées dans le JavaScript au moment du build : après avoir rempli
// `.env.local` ou les variables Vercel, il faut relancer `npm run build`.

export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase n'est pas configuré : NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY est absente.",
    );
    this.name = 'SupabaseNotConfiguredError';
  }
}

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function requireSupabasePublicConfig(): SupabasePublicConfig {
  const config = getSupabasePublicConfig();
  if (!config) throw new SupabaseNotConfiguredError();
  return config;
}

export function isSupabaseConfigured(): boolean {
  return getSupabasePublicConfig() !== null;
}
