import { currentKeyAction, describeKey, type KeyTestState } from '@/lib/keys/capture';
import { KEY_ACTIONS, KEY_ACTION_HINTS, KEY_ACTION_LABELS } from '@/lib/types';

// « Test des touches » (docs/conception.md §5), en mode guidé : une action à la fois, et ce que reçoit l'app
// affiché en direct, en mots (« flèche droite », « D »), pour comprendre ce qu'envoie un clavier
// inhabituel. Il ne s'ouvre que par ?touches=test (plus de manette).
// Le bloc part d'une marge haute fixe : la consigne, lue à 1–2 m, ne bouge pas quand la liste des
// touches déjà choisies s'allonge dessous.

export function KeyTestScreen({ test }: { test: KeyTestState }) {
  const action = currentKeyAction(test);

  return (
    <section data-testid="mirror-key-test" className="flex w-full flex-1 flex-col items-center gap-6 pt-40 text-center">
      <p className="text-mirror-sm text-mirror-dim">
        Test des touches · {Math.min(test.step + 1, KEY_ACTIONS.length)} / {KEY_ACTIONS.length}
      </p>
      <p className="text-mirror-md text-mirror-ink">Appuie sur la touche pour :</p>
      <p data-testid="key-test-action" className="text-mirror-xl font-medium text-mirror-ink">
        {KEY_ACTION_LABELS[action]}
      </p>
      <p data-testid="key-test-hint" className="text-mirror-sm text-mirror-dim">
        Conseillé : {KEY_ACTION_HINTS[action]}
      </p>

      <p data-testid="key-test-error" role="alert" className="min-h-10 text-mirror-sm text-mirror-ink">
        {test.error ?? ''}
      </p>

      <p data-testid="key-test-received" className="text-mirror-sm text-mirror-dim">
        {test.received ? `Reçu : ${describeKey(test.received)}` : 'En attente d’une touche'}
      </p>

      {KEY_ACTIONS.some((candidate) => test.bindings[candidate]) && (
        <dl
          data-testid="key-test-bindings"
          className="mt-4 grid grid-cols-[auto_auto] gap-x-8 gap-y-2 text-left text-mirror-sm text-mirror-dim"
        >
          {KEY_ACTIONS.map((candidate) => {
            const binding = test.bindings[candidate];
            if (!binding) return null;
            return (
              <div key={candidate} className="contents">
                <dt>{KEY_ACTION_LABELS[candidate]}</dt>
                <dd>{describeKey(binding)}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
