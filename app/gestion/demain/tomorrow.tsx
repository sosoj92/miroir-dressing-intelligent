import { CheckIcon } from '@/components/wardrobe/icons';
import { formatDayLabel } from '@/lib/dates';
import { KeepButton } from './keep-button';
import { OutfitPreview } from './outfit-preview';
import { RestartButton } from './restart-button';
import { weatherLine, type TomorrowView } from './view';

// Ce que montre la page Demain (docs/conception.md §4), une fois les données lues (page.tsx) : la date et la
// météo, la tenue en tête, « Recommencer le choix », puis les autres tenues par deux.

/** En attente : la place de la date et de la météo, puis celle de la tenue en tête et de sa légende. */
export function TomorrowFallback() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-body">&nbsp;</p>
        <p className="text-footnote">&nbsp;</p>
      </div>
      {/* Comme OutfitPreview en grand : la plaque foncée pleine largeur (400 px de silhouette, 16 px
          dessus et dessous), déjà de sa couleur, sans flash blanc ; puis deux lignes de légende. */}
      <div className="flex flex-col gap-2">
        <div className="h-[432px] w-full rounded-xl bg-photo" />
        <p className="text-body">
          &nbsp;
          <br />
          &nbsp;
        </p>
      </div>
    </div>
  );
}

/**
 * Tenue gardée : « Prévue pour demain » à la place exacte de « Garder pour demain » (même hauteur,
 * centré), là où l'on a appuyé. Le titre de la section le dit déjà au lecteur d'écran.
 */
function PlannedMark() {
  return (
    <p aria-hidden="true" className="flex min-h-11 items-center justify-center gap-1.5 text-body font-semibold text-ink">
      <CheckIcon width={17} height={17} />
      Prévue pour demain
    </p>
  );
}

export function Tomorrow({ view }: { view: TomorrowView }) {
  // Sans tenue gardée, la première proposition prend sa place, avec « Garder pour demain ».
  const top = view.planned ?? view.suggestions[0] ?? null;
  const others = view.planned ? view.suggestions : view.suggestions.slice(1);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-body">{formatDayLabel(view.date)}</p>
        <p className="text-footnote text-muted">
          {view.weather ? weatherLine(view.weather) : 'Météo indisponible'}
        </p>
      </div>

      {top && (
        <section className="flex flex-col gap-3">
          {view.planned && <h2 className="sr-only">Prévue pour demain</h2>}
          <OutfitPreview
            outfit={top}
            size="large"
            action={
              view.planned ? <PlannedMark /> : <KeepButton itemIds={top.item_ids} label="Garder pour demain" prominent />
            }
          />
          {/* Pièce de la tenue gardée passée au sale depuis : par quoi le miroir la remplace. */}
          {view.planned && view.planNotes.length > 0 && (
            <div className="text-center text-footnote text-muted">
              {view.planNotes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Sous la tenue en tête, avant les autres : on le trouve sans faire défiler. */}
      {view.restart && <RestartButton date={view.date} hasPlan={view.restart.hasPlan} refused={view.restart.refused} />}

      {others.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-body font-semibold">Autres tenues</h2>
          {/* Nombre impair : la dernière case reste seule à gauche. */}
          <ul className="grid grid-cols-2 gap-3">
            {others.map((outfit) => (
              <li key={outfit.key}>
                <OutfitPreview outfit={outfit} size="small" action={<KeepButton itemIds={outfit.item_ids} label="Garder" />} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!top && (
        <p className="text-body text-muted">
          {view.hasItems ? 'Aucune tenue à proposer pour demain.' : 'Ta garde-robe est vide.'}
        </p>
      )}
    </div>
  );
}
