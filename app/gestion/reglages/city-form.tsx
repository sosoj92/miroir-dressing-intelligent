'use client';

import { unstable_rethrow } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { buttonRowClass, fieldRowClass, Group, Row } from '@/components/gestion/group';
import { SearchIcon } from '@/components/gestion/icons';
import { CONNECTION_LOST, MessageLine, type Message } from '@/components/gestion/message-line';
import type { CityResult } from '@/lib/geocoding/parse';
import { saveCity, searchCity } from './actions';

// Ville de la météo : la ville actuelle, puis une recherche (Open-Meteo, par le serveur) envoyée par
// la touche Rechercher du clavier. Les villes trouvées sont des lignes du même encart : en toucher
// une l'enregistre. Une ville enregistrée s'écrit en gris, un échec de la couleur du texte (MessageLine).
export function CityForm({ initialCity }: { initialCity: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [current, setCurrent] = useState(initialCity);
  const [results, setResults] = useState<CityResult[]>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get('city') ?? '');
    setMessage(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof searchCity>>;
      try {
        result = await searchCity(query);
      } catch (caught) {
        unstable_rethrow(caught);
        setResults([]);
        setMessage(CONNECTION_LOST);
        return;
      }
      if (!result.ok) {
        setResults([]);
        setMessage({ text: result.error, error: true });
        return;
      }
      setResults(result.results);
      // Pas un échec : la recherche a abouti, sans résultat.
      setMessage(result.results.length === 0 ? { text: 'Aucune ville trouvée.', error: false } : null);
    });
  }

  function choose(city: CityResult) {
    // Effacé d'abord : deux échecs de suite remontent le message, qui est de nouveau annoncé.
    setMessage(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof saveCity>>;
      try {
        result = await saveCity({ name: city.name, lat: city.lat, lon: city.lon, timezone: city.timezone });
      } catch (caught) {
        unstable_rethrow(caught);
        setMessage(CONNECTION_LOST);
        return;
      }
      if (!result.ok) {
        setMessage({ text: result.error, error: true });
        return;
      }
      setCurrent(city.name);
      setResults([]);
      formRef.current?.reset();
      setMessage({ text: `Ville enregistrée : ${city.label}.`, error: false });
    });
  }

  return (
    <div className="flex flex-col">
      <Group title="Météo">
        <Row value={current}>Ville</Row>
        {/* Sans bouton : la touche Rechercher du clavier envoie le formulaire (un seul champ). */}
        <form ref={formRef} onSubmit={handleSearch} role="search" className={fieldRowClass}>
          {/* La loupe et le champ dans le même <label> : toucher la loupe place le curseur. */}
          <label className="flex min-w-0 flex-1 items-center gap-2 text-muted">
            <SearchIcon className="size-[17px] shrink-0" />
            <span className="sr-only">Chercher une autre ville</span>
            <input
              name="city"
              type="search"
              placeholder="Chercher une autre ville"
              autoComplete="address-level2"
              enterKeyHint="search"
              required
              minLength={2}
              maxLength={80}
              aria-busy={pending}
              className="-my-[11px] min-h-11 min-w-0 flex-1 appearance-none bg-transparent text-body text-ink outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
            />
          </label>
        </form>
        {results.map((city) => (
          <button
            key={`${city.label}-${city.lat}-${city.lon}`}
            type="button"
            disabled={pending}
            onClick={() => choose(city)}
            className={buttonRowClass}
          >
            {city.label}
          </button>
        ))}
      </Group>
      <MessageLine message={message} className="px-4 pt-1.5" />
    </div>
  );
}
