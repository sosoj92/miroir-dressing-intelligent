import { useSyncExternalStore } from 'react';

// Une valeur qui change à chaque image de la caméra (anneau, debug), lue par les seuls composants
// qui l'affichent (useSyncExternalStore) : le miroir entier ne se redessine pas 30 fois par seconde.

export type Store<T> = {
  get(): T;
  /** Nouvelle valeur ; rien ne se passe si `same` la dit égale à l'actuelle. */
  set(value: T): void;
  subscribe(listener: () => void): () => void;
};

export function createStore<T>(initial: T, same: (a: T, b: T) => boolean = Object.is): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (same(value, next)) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** La valeur d'un store ; `initial` au rendu serveur. */
export function useStore<T>(store: Store<T>, initial: T): T {
  return useSyncExternalStore(store.subscribe, store.get, () => initial);
}
