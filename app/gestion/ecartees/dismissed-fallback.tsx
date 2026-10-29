import { Group, rowClass } from '@/components/gestion/group';

// Tenues écartées en attente de la session (page.tsx) : la liste groupée avec trois lignes vides,
// chacune de la hauteur d'un refus courant (deux pièces, deux lignes de texte), sans animation.
export function DismissedFallback() {
  return (
    <div aria-hidden="true">
      <Group>
        {[0, 1, 2].map((row) => (
          <div key={row} className={rowClass}>
            <p>
              &nbsp;
              <br />
              &nbsp;
            </p>
          </div>
        ))}
      </Group>
    </div>
  );
}
