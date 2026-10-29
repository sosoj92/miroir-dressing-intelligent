import { Group, rowClass } from '@/components/gestion/group';

// Accueil du téléphone en attente de la session (app/gestion/page.tsx) : les deux encarts, vides,
// sans animation, à la place exacte des vrais ; « 3 au sale » et « Prévue » s'y posent ensuite.
// Pas les vrais liens : une session expirée les montrerait avant « Connexion requise ».
export function HomeFallback() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-8">
      {[0, 1].map((group) => (
        <Group key={group}>
          <div className={rowClass}>&nbsp;</div>
          <div className={rowClass}>&nbsp;</div>
        </Group>
      ))}
    </div>
  );
}
