'use client';

import { useSyncExternalStore } from 'react';
import { DEFAULT_TIME_ZONE, formatDayLabel, isoDateInTimeZone } from '@/lib/dates';

// Date du miroir. Sans `isoDate`, c'est la date du jour, calculée dans le navigateur : la page
// reste statique et la date change à minuit sans rechargement. Avec `isoDate`, c'est le jour
// visé par les tenues (demain après l'heure du soir). Rien n'est rendu côté serveur.
const REFRESH_MS = 30_000;

function subscribe(onChange: () => void) {
  const id = window.setInterval(onChange, REFRESH_MS);
  return () => window.clearInterval(id);
}

function getSnapshot() {
  return isoDateInTimeZone(new Date(), DEFAULT_TIME_ZONE);
}

function getServerSnapshot() {
  return null;
}

/** `afterWord` : la date suit un mot (« Demain · lundi 26 octobre ») et commence en minuscule. */
export function MirrorDate({ isoDate, afterWord = false }: { isoDate?: string; afterWord?: boolean }) {
  const today = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const shown = isoDate ?? today;
  if (!shown) return null;
  const label = formatDayLabel(shown);

  return (
    <time dateTime={shown} data-testid="mirror-date">
      {afterWord ? label.charAt(0).toLocaleLowerCase('fr-FR') + label.slice(1) : label}
    </time>
  );
}
