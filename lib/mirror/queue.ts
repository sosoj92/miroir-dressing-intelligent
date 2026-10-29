// File d'envoi du miroir (docs/conception.md §7 bis) : accepter, refuser, recommencer et enregistrer les touches
// n'attendent jamais le réseau. Les requêtes partent dans l'ordre : un « recommencer » envoyé après
// une acceptation l'efface bien, et une acceptation qui le suit est gardée. L'écran change tout de suite, la requête part en arrière-plan,
// et reste dans la file (gardée dans localStorage) tant que le serveur ne l'a pas reçue.
// Rien n'est journalisé : ni les corps, ni les réponses.

export const QUEUE_STORAGE_KEY = 'mon-dressing:miroir:file';
/** Nouvel essai toutes les 30 s, et au retour du réseau (événement `online`). */
export const QUEUE_RETRY_MS = 30_000;
/** Au-delà, les plus anciennes requêtes sont abandonnées. */
export const MAX_QUEUE_LENGTH = 50;
/** Réponses d'erreur du serveur (5xx, 401…) tolérées avant d'abandonner une requête. */
export const MAX_SERVER_ATTEMPTS = 20;

export const QUEUE_ENDPOINTS = [
  '/api/miroir/accepter',
  '/api/miroir/refuser',
  '/api/miroir/recommencer',
  '/api/miroir/touches',
] as const;
export type QueueEndpoint = (typeof QUEUE_ENDPOINTS)[number];

export type QueueRequest = {
  endpoint: QueueEndpoint;
  body: Record<string, unknown>;
  /** Deux requêtes de même clé : seule la dernière part (ex. deux tenues acceptées le même jour). */
  dedupeKey: string;
};

export type QueueJob = QueueRequest & { id: string; attempts: number };

export type Outcome = 'done' | 'retry' | 'drop';

/** Que faire d'une requête après la réponse du serveur. */
export function outcomeForStatus(status: number): Outcome {
  if (status >= 200 && status < 300) return 'done';
  // Session absente (la tablette sera reconnectée), délai, trop de requêtes, serveur indisponible.
  if (status === 401 || status === 408 || status === 429 || status >= 500) return 'retry';
  // 400, 403, 404, 413… : la requête ne passera jamais telle quelle.
  return 'drop';
}

/**
 * Ajoute une requête : remplace celle de même clé, garde au plus MAX_QUEUE_LENGTH requêtes. Un
 * « Recommencer » qui en remplace un autre garde aussi les refus que le premier nommait.
 */
export function enqueue(jobs: readonly QueueJob[], job: QueueJob): QueueJob[] {
  const replaced = jobs.filter((existing) => existing.dedupeKey === job.dedupeKey);
  let added = job;
  if (job.endpoint === '/api/miroir/recommencer' && replaced.length > 0) {
    const named: string[][] = [];
    for (const ids of [...replaced.flatMap((existing) => namedRefusals(existing)), ...namedRefusals(job)]) {
      const key = [...ids].sort().join('+');
      if (!named.some((other) => [...other].sort().join('+') === key)) named.push(ids);
    }
    added = { ...job, body: { ...job.body, refused: named.slice(-MAX_NAMED_REFUSALS) } };
  }
  const next = [...jobs.filter((existing) => existing.dedupeKey !== job.dedupeKey), added];
  return next.slice(-MAX_QUEUE_LENGTH);
}

/** Refus nommés au plus par un « Recommencer » (MAX_RESTART_REFUSALS côté serveur). */
export const MAX_NAMED_REFUSALS = 30;

function namedRefusals(job: QueueJob): string[][] {
  return Array.isArray(job.body.refused) ? job.body.refused.filter(isIdList) : [];
}

function isEndpoint(value: unknown): value is QueueEndpoint {
  return typeof value === 'string' && (QUEUE_ENDPOINTS as readonly string[]).includes(value);
}

function isJob(value: unknown): value is QueueJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Record<string, unknown>;
  return (
    typeof job.id === 'string' &&
    isEndpoint(job.endpoint) &&
    typeof job.dedupeKey === 'string' &&
    typeof job.attempts === 'number' &&
    Number.isFinite(job.attempts) &&
    !!job.body &&
    typeof job.body === 'object' &&
    !Array.isArray(job.body)
  );
}

/** Relit la file gardée dans localStorage, en ignorant tout ce qui n'a pas la bonne forme. */
export function parseStoredQueue(raw: string | null): QueueJob[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isJob).slice(-MAX_QUEUE_LENGTH) : [];
  } catch {
    return [];
  }
}

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string');
}

/**
 * « Recommencer », « oui » pour demain (la tenue prévue) ou « oui » pour aujourd'hui (la tenue
 * portée, « Choisie ») : un choix que le serveur n'a peut-être pas encore.
 */
export type PendingChoice =
  | { kind: 'restart'; date: string; today: string; refused: string[][] }
  | { kind: 'plan'; date: string; item_ids: string[] }
  | { kind: 'history'; date: string; item_ids: string[]; title: string | null };

/** Requête qui change le choix du jour visé : « Recommencer », ou « oui » (pour demain ou aujourd'hui). */
export function isChoiceJob(job: QueueRequest): boolean {
  return (
    job.endpoint === '/api/miroir/recommencer' ||
    (job.endpoint === '/api/miroir/accepter' && (job.body.target === 'plan' || job.body.target === 'history'))
  );
}

/**
 * Les choix qui attendent d'être envoyés, dans l'ordre de la file (celui où le serveur les
 * recevra). Les données relues du serveur ne les reflètent pas encore : la tablette les y
 * applique elle-même (pendingPayload), sinon elle croirait que la tenue prévue a changé, ou que la
 * tenue du jour n'est plus « Choisie ».
 */
export function pendingChoices(jobs: readonly QueueJob[]): PendingChoice[] {
  const choices: PendingChoice[] = [];
  for (const job of jobs) {
    if (!isChoiceJob(job) || typeof job.body.date !== 'string') continue;
    if (job.endpoint === '/api/miroir/recommencer') {
      if (typeof job.body.today !== 'string') continue;
      const refused = Array.isArray(job.body.refused) ? job.body.refused.filter(isIdList) : [];
      choices.push({ kind: 'restart', date: job.body.date, today: job.body.today, refused });
    } else if (isIdList(job.body.item_ids) && job.body.target === 'history') {
      const title = typeof job.body.title === 'string' ? job.body.title : null;
      choices.push({ kind: 'history', date: job.body.date, item_ids: job.body.item_ids, title });
    } else if (isIdList(job.body.item_ids)) {
      choices.push({ kind: 'plan', date: job.body.date, item_ids: job.body.item_ids });
    }
  }
  return choices;
}

/** Pièces des refus encore dans la file : ceux-là, le serveur ne les a pas encore reçus. */
export function pendingRefusalIds(jobs: readonly QueueJob[]): string[][] {
  return jobs
    .filter((job) => job.endpoint === '/api/miroir/refuser' && isIdList(job.body.item_ids))
    .map((job) => job.body.item_ids as string[]);
}

/** Correspondance touches en attente d'envoi : elle prime sur celle des données du serveur. */
export function pendingKeyMapBody(jobs: readonly QueueJob[]): unknown {
  const job = [...jobs].reverse().find((candidate) => candidate.endpoint === '/api/miroir/touches');
  return job ? job.body.keyMap : undefined;
}

// ------------------------------------------------------------------ Exécution

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type QueueDeps = {
  fetch: (input: string, init: RequestInit) => Promise<{ status: number }>;
  /** localStorage, ou null s'il est inaccessible. Chaque appel est protégé. */
  storage: KeyValueStore | null;
  makeId?: () => string;
  onChange?: (jobs: readonly QueueJob[]) => void;
};

export type MirrorQueue = {
  push(request: QueueRequest): void;
  flush(): Promise<void>;
  jobs(): readonly QueueJob[];
};

function defaultId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createQueue(deps: QueueDeps): MirrorQueue {
  const makeId = deps.makeId ?? defaultId;
  let jobs: QueueJob[] = readStored();
  let running: Promise<void> | null = null;
  let again = false;

  function readStored(): QueueJob[] {
    try {
      return parseStoredQueue(deps.storage?.getItem(QUEUE_STORAGE_KEY) ?? null);
    } catch {
      return [];
    }
  }

  function save(next: QueueJob[]) {
    jobs = next;
    try {
      deps.storage?.setItem(QUEUE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Stockage plein ou interdit : la file reste en mémoire.
    }
    deps.onChange?.(next);
  }

  async function sendAll() {
    while (jobs.length > 0) {
      const job = jobs[0];
      let status: number;
      try {
        const response = await deps.fetch(job.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(job.body),
          credentials: 'same-origin',
          cache: 'no-store',
          // La requête survit à un rechargement de la page.
          keepalive: true,
        });
        status = response.status;
      } catch {
        return; // Pas de réseau : on réessaiera plus tard, sans compter d'essai.
      }

      const outcome = outcomeForStatus(status);
      const rest = jobs.filter((candidate) => candidate.id !== job.id);
      if (outcome !== 'retry') {
        save(rest);
        continue;
      }
      const attempts = job.attempts + 1;
      if (attempts >= MAX_SERVER_ATTEMPTS) {
        save(rest);
        continue;
      }
      save(jobs.map((candidate) => (candidate.id === job.id ? { ...candidate, attempts } : candidate)));
      return;
    }
  }

  function flush(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await sendAll();
        } while (again && jobs.length > 0);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    push(request) {
      save(enqueue(jobs, { ...request, id: makeId(), attempts: 0 }));
      void flush();
    },
    flush,
    jobs: () => jobs,
  };
}
