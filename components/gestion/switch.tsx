'use client';

// Interrupteur du téléphone (direction A) : piste 51×31, pastille de 27 px, prune quand il est
// allumé. Le bouton fait 44 px de haut (zone à toucher) ; la piste est centrée dedans.

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Nom lu par le lecteur d'écran : le libellé de la ligne (« Au sale »). */
  label: string;
  disabled?: boolean;
  /** Enregistrement en cours (aria-busy). */
  busy?: boolean;
};

export function Switch({ checked, onChange, label, disabled, busy }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group/switch flex min-h-11 shrink-0 items-center outline-none disabled:opacity-60"
    >
      <span
        className={`flex h-[31px] w-[51px] items-center rounded-full group-focus-visible/switch:outline-2 group-focus-visible/switch:outline-offset-2 group-focus-visible/switch:outline-accent ${
          checked ? 'bg-accent' : 'bg-switch-off'
        }`}
      >
        {/* Pastille blanche dans les deux thèmes, comme sur iPhone (aucun jeton ne reste blanc en sombre),
            avec l'ombre neutre qui la détache de la piste éteinte en clair. */}
        <span
          className={`size-[27px] rounded-full bg-white shadow-control transition-transform duration-200 ease-out motion-reduce:transition-none ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}
