'use client';

import { unstable_rethrow } from 'next/navigation';
import { useState, useTransition, type ChangeEvent } from 'react';
import { fieldRowClass, Group } from '@/components/gestion/group';
import { ChevronUpDown } from '@/components/gestion/icons';
import { CONNECTION_LOST, MessageLine, type Message } from '@/components/gestion/message-line';
import { saveEveningHour } from './actions';
import { EVENING_HOURS } from './evening-hour';

// Heure à partir de laquelle le miroir propose la tenue de demain (docs/conception.md §4), enregistrée au choix.
// Une ligne « Tenues de demain dès · 18 h » : le menu natif, invisible, couvre toute la ligne.
export function EveningHourForm({ initialHour }: { initialHour: number }) {
  const [hour, setHour] = useState(initialHour);
  const [message, setMessage] = useState<Message | null>(null);
  const [pending, startTransition] = useTransition();

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const previous = hour;
    const next = Number(event.currentTarget.value);
    setHour(next);
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await saveEveningHour(next);
        if (result.ok) {
          setMessage({ text: 'Enregistré.', error: false });
        } else {
          setHour(previous);
          setMessage({ text: result.error, error: true });
        }
      } catch (caught) {
        // Connexion coupée : le menu revient à l'heure enregistrée.
        unstable_rethrow(caught);
        setHour(previous);
        setMessage(CONNECTION_LOST);
      }
    });
  }

  return (
    <div className="flex flex-col">
      <Group title="Préparer demain">
        <label className={`${fieldRowClass} ${pending ? 'opacity-60' : ''}`}>
          <span>Tenues de demain dès</span>
          <span className="flex items-center gap-1 text-muted">
            {hour} h
            <ChevronUpDown />
          </span>
          <select
            aria-label="Tenues de demain dès"
            value={hour}
            onChange={handleChange}
            disabled={pending}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          >
            {EVENING_HOURS.map((value) => (
              <option key={value} value={value}>
                {value} h
              </option>
            ))}
          </select>
        </label>
      </Group>
      <MessageLine message={message} className="px-4 pt-1.5" />
    </div>
  );
}
