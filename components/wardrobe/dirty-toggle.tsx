'use client';

import { unstable_rethrow } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { setDirty } from '@/app/gestion/garde-robe/actions';
import { Group, Row } from '@/components/gestion/group';
import { CONNECTION_LOST } from '@/components/gestion/message-line';
import { Switch } from '@/components/gestion/switch';

/**
 * Bascule « Au sale » oui ou non (docs/conception.md §4, écran 2). L'état change tout de suite à l'écran ; en cas
 * d'échec (connexion coupée comprise), useOptimistic revient seul à l'état enregistré.
 */
export function DirtyToggle({ id, dirty }: { id: string; dirty: boolean }) {
  const [shown, setShown] = useOptimistic(dirty);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !shown;
    setError(null);
    startTransition(async () => {
      setShown(next);
      try {
        const result = await setDirty(id, next);
        if (!result.ok) setError(result.error);
      } catch (caught) {
        unstable_rethrow(caught);
        setError(CONNECTION_LOST.text);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Group>
        <Row control={<Switch label="Au sale" checked={shown} onChange={toggle} disabled={pending} busy={pending} />}>
          Au sale
        </Row>
      </Group>
      {error ? (
        <p role="alert" className="px-4 text-footnote text-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
