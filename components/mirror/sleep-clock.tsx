'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_TIME_ZONE } from '@/lib/dates';
import { formatClock, sleepClockColor } from '@/lib/mirror/timing';

// Veille (docs/conception.md §4) : seulement l'heure, grande et fine, en gris (plus sombre la nuit).
const CLOCK_REFRESH_MS = 15_000;

function subscribe(onChange: () => void) {
  const id = window.setInterval(onChange, CLOCK_REFRESH_MS);
  return () => window.clearInterval(id);
}

function getServerSnapshot() {
  return null;
}

/** Fuseau de l'appareil : sans données (écran de problème), il n'y a pas encore celui du profil. */
function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** `timeZone` : celui du profil, ou null avant les données (fuseau de l'appareil). */
export function SleepClock({ timeZone }: { timeZone: string | null }) {
  const getSnapshot = useCallback(() => {
    const now = new Date();
    const zone = timeZone ?? deviceTimeZone();
    return `${formatClock(now, zone)}|${sleepClockColor(now, zone)}`;
  }, [timeZone]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [time, color] = snapshot ? snapshot.split('|') : [null, undefined];

  return (
    <p
      data-testid="mirror-sleep"
      className="m-auto text-mirror-clock leading-none font-light tabular-nums"
      style={{ color }}
    >
      {time}
    </p>
  );
}
