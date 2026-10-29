import { Group, rowClass } from '@/components/gestion/group';
import { RestoreButton } from './restore-button';
import type { DismissedRow } from './rows';

/**
 * La liste des tenues écartées : une ligne de liste groupée par refus, les pièces vues une par
 * ligne (couleur du texte), la pièce cachée et une pièce supprimée en gris, « Remettre » à droite.
 * flex-wrap : un échec de « Remettre » passe sous les noms, sur toute la largeur (restore-button.tsx).
 */
export function DismissedList({ rows }: { rows: readonly DismissedRow[] }) {
  return (
    <Group>
      {rows.map((row) => (
        <div key={row.id} className={`${rowClass} flex-wrap gap-y-0`}>
          <div className="min-w-0 flex-1">
            {/* Une pièce, une ligne, comme sous le miroir : un nom trop long finit en « … » (lu en
                entier par VoiceOver). Coupé en deux, il se lirait comme deux pièces. */}
            {row.lines.map((line, index) => (
              <p key={`${index}:${line}`} className="truncate">
                {line}
              </p>
            ))}
            {/* La note, en gris, passe à la ligne : elle ne se confond pas avec une pièce. */}
            {row.note ? <p className="text-footnote text-muted">{row.note}</p> : null}
            {row.missing ? <p className="text-footnote text-muted">{row.missing}</p> : null}
          </div>
          <RestoreButton id={row.id} />
        </div>
      ))}
    </Group>
  );
}
