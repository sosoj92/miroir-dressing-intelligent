'use client';

import Link from 'next/link';
import { useState, type ChangeEvent } from 'react';
import { pressFeedback } from '@/components/gestion/buttons';
import { assemblyDetail, assemblySummary, importAssemblyPackage, openAssemblyPackage } from '@/lib/import/assemblage-client';
import { detailLine, importPrototypeFile, summaryLine } from '@/lib/import/client';
import { createClient } from '@/lib/supabase/browser';
import { SupabaseNotConfiguredError } from '@/lib/supabase/config';
import { finishAssemblyImport, importAssembly, importPrototype } from './actions';
import { holdScreen, progressMessage, sendingHint } from './progress';

/** Un fichier plus gros ne tient pas dans la mémoire d'un téléphone ouvert dans le navigateur. */
const MAX_FILE_BYTES = 500 * 1024 * 1024;

type Phase =
  | { kind: 'idle' }
  /** `held` : écran gardé allumé (Wake Lock) ; sinon la consigne demande de le garder allumé. */
  | { kind: 'working'; message: string; held: boolean }
  | { kind: 'done'; summary: string; detail: string }
  | { kind: 'error'; message: string };

export function ImportForm({ userId }: { userId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const working = phase.kind === 'working';

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // rechoisir le même fichier relance l'import
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setPhase({ kind: 'error', message: 'Ce fichier est trop gros.' });
      return;
    }

    // Le téléphone ne doit pas se mettre en veille pendant l'envoi : le verrou est redemandé au
    // retour sur la page, relâché à la fin. La consigne suit son état à chaque message.
    const hold = await holdScreen('wakeLock' in navigator ? navigator.wakeLock : undefined, document);
    const report = (message: string) => setPhase({ kind: 'working', message, held: hold.held });
    report(progressMessage({ step: 'read' }));
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Client créé ici et pas au rendu : la page s'affiche même sans Supabase configuré.
      let supabase: ReturnType<typeof createClient> | null = null;
      const upload = async (path: string, body: Uint8Array, contentType: string): Promise<boolean> => {
        supabase ??= createClient();
        const { error } = await supabase.storage.from('items').upload(path, body, { upsert: true, contentType });
        return !error;
      };

      // Paquet d'assemblage (manifest.json « mon-dressing/assemblage ») ou dossier du prototype.
      const assembly = openAssemblyPackage(bytes);
      if (assembly && !assembly.ok) {
        setPhase({ kind: 'error', message: assembly.error });
        return;
      }
      if (assembly) {
        const outcome = await importAssemblyPackage(assembly.pkg, {
          userId,
          upload,
          send: (batch) => importAssembly(batch),
          finish: (cleanup) => finishAssemblyImport(cleanup),
          onProgress: (progress) => report(progressMessage(progress)),
        });
        setPhase(
          outcome.ok
            ? { kind: 'done', summary: assemblySummary(outcome), detail: assemblyDetail(outcome) }
            : { kind: 'error', message: outcome.error },
        );
        return;
      }

      const outcome = await importPrototypeFile(bytes, {
        userId,
        now: new Date(),
        upload,
        send: (batch) => importPrototype(batch),
        onProgress: (progress) => report(progressMessage(progress)),
      });

      if (outcome.ok) {
        setPhase({ kind: 'done', summary: summaryLine(outcome.counts), detail: detailLine(outcome) });
      } else {
        setPhase({ kind: 'error', message: outcome.error });
      }
    } catch (error) {
      setPhase({
        kind: 'error',
        message:
          error instanceof SupabaseNotConfiguredError
            ? "La connexion n'est pas encore configurée."
            : "L'import a échoué. Réessaie : il reprend sans doublon.",
      });
    } finally {
      void hold.release();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Une ligne d'explication. Le dossier du prototype et son db.json restent acceptés sans le dire. */}
      <p className="text-footnote text-muted">
        {phase.kind === 'working' ? sendingHint(phase.held) : 'Choisis le .zip préparé sur le PC.'}
      </p>

      <label
        className={`rounded-xl bg-accent px-4 py-3 text-center text-body font-semibold text-on-accent ${
          working ? 'opacity-60' : 'cursor-pointer'
        }`}
      >
        {working ? 'Import en cours…' : 'Choisir un fichier'}
        <input
          type="file"
          accept=".zip,.json,application/zip,application/x-zip-compressed,application/json"
          className="sr-only"
          disabled={working}
          onChange={handleChange}
        />
      </label>

      {/* La progression et le bilan en role=status ; un échec à part, en role=alert, de la couleur
          du texte : il ne se lit pas comme une étape de plus. Un seul bloc : même espacement. */}
      <div>
        <div role="status" aria-live="polite" className="flex flex-col gap-1">
          {phase.kind === 'working' && <p className="text-body text-muted">{phase.message}</p>}
          {phase.kind === 'done' && (
            <>
              <p className="text-body">{phase.summary}</p>
              {phase.detail && <p className="text-footnote text-muted">{phase.detail}</p>}
            </>
          )}
        </div>
        {phase.kind === 'error' && (
          <p role="alert" className="text-body text-ink">
            {phase.message}
          </p>
        )}
      </div>

      {phase.kind === 'done' && (
        <Link
          href="/gestion/garde-robe"
          className={`inline-flex min-h-11 items-center self-start text-body text-accent ${pressFeedback}`}
        >
          Voir la garde-robe
        </Link>
      )}
    </div>
  );
}
