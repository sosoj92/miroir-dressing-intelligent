import { describe, expect, it, vi } from 'vitest';
import {
  MAX_QUEUE_LENGTH,
  MAX_SERVER_ATTEMPTS,
  QUEUE_STORAGE_KEY,
  createQueue,
  enqueue,
  isChoiceJob,
  outcomeForStatus,
  parseStoredQueue,
  pendingChoices,
  pendingKeyMapBody,
  pendingRefusalIds,
  type KeyValueStore,
  type QueueJob,
  type QueueRequest,
} from './queue';

function job(id: string, dedupeKey = id, overrides: Partial<QueueJob> = {}): QueueJob {
  return { id, endpoint: '/api/miroir/refuser', body: { item_ids: [id] }, dedupeKey, attempts: 0, ...overrides };
}

function memoryStorage(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const ACCEPT: QueueRequest = {
  endpoint: '/api/miroir/accepter',
  body: { date: '2026-10-24', item_ids: ['a'] },
  dedupeKey: 'accepter:2026-10-24',
};

function counter() {
  let n = 0;
  return () => `job-${++n}`;
}

describe('partie pure', () => {
  it('classe les réponses : succès, nouvel essai, abandon', () => {
    expect(outcomeForStatus(200)).toBe('done');
    expect(outcomeForStatus(204)).toBe('done');
    expect(outcomeForStatus(500)).toBe('retry');
    expect(outcomeForStatus(503)).toBe('retry');
    expect(outcomeForStatus(429)).toBe('retry');
    expect(outcomeForStatus(401)).toBe('retry');
    expect(outcomeForStatus(400)).toBe('drop');
    expect(outcomeForStatus(403)).toBe('drop');
    expect(outcomeForStatus(413)).toBe('drop');
  });

  it('remplace une requête de même clé et garde l’ordre', () => {
    const jobs = enqueue(enqueue(enqueue([], job('1', 'a')), job('2', 'b')), job('3', 'a'));
    expect(jobs.map((entry) => entry.id)).toEqual(['2', '3']);
  });

  it('borne la longueur de la file en abandonnant les plus anciennes', () => {
    let jobs: QueueJob[] = [];
    for (let i = 0; i < MAX_QUEUE_LENGTH + 5; i++) jobs = enqueue(jobs, job(String(i)));
    expect(jobs).toHaveLength(MAX_QUEUE_LENGTH);
    expect(jobs[0].id).toBe('5');
  });

  it('relit la file en ignorant ce qui n’a pas la bonne forme', () => {
    expect(parseStoredQueue(null)).toEqual([]);
    expect(parseStoredQueue('pas du json')).toEqual([]);
    expect(parseStoredQueue('{"a":1}')).toEqual([]);
    const valid = job('1');
    const raw = JSON.stringify([valid, { ...valid, endpoint: '/api/autre' }, { id: 2 }, null]);
    expect(parseStoredQueue(raw)).toEqual([valid]);
  });

  it('garde un « recommencer » relu de localStorage et le retrouve, avec ses refus nommés', () => {
    const restart = job('r', 'recommencer:2026-10-25', {
      endpoint: '/api/miroir/recommencer',
      body: { date: '2026-10-25', today: '2026-10-24', refused: [['a', 'b'], 'pas une liste'] },
    });
    expect(parseStoredQueue(JSON.stringify([restart]))).toEqual([restart]);
    expect(pendingChoices([job('1'), restart])).toEqual([
      { kind: 'restart', date: '2026-10-25', today: '2026-10-24', refused: [['a', 'b']] },
    ]);
    expect(pendingChoices([job('1')])).toEqual([]);
    // Ancienne forme, sans refus nommés ; forme invalide ignorée.
    const old = job('o', 'recommencer:x', { endpoint: '/api/miroir/recommencer', body: { date: '2026-10-25', today: '2026-10-24' } });
    const broken = job('b', 'recommencer:y', { endpoint: '/api/miroir/recommencer', body: { date: 3 } });
    expect(pendingChoices([old, broken])).toEqual([{ kind: 'restart', date: '2026-10-25', today: '2026-10-24', refused: [] }]);
  });

  it('liste les choix en attente dans l’ordre de la file : « oui » (demain ou aujourd’hui) et « Recommencer »', () => {
    const plan = job('p', 'accepter:plan:2026-10-25', {
      endpoint: '/api/miroir/accepter',
      body: { date: '2026-10-25', item_ids: ['h', 'b'], title: 'T', target: 'plan' },
    });
    const today = job('t', 'accepter:history:2026-10-24', {
      endpoint: '/api/miroir/accepter',
      body: { date: '2026-10-24', item_ids: ['h', 'b'], target: 'history' },
    });
    const restart = job('r', 'recommencer:2026-10-25', {
      endpoint: '/api/miroir/recommencer',
      body: { date: '2026-10-25', today: '2026-10-24' },
    });
    // « Oui » pour aujourd'hui (tenue portée) est rejoué aussi : la tenue reste « Choisie ». Les
    // refus ne sont pas des choix.
    expect(pendingChoices([plan, today, job('1'), restart])).toEqual([
      { kind: 'plan', date: '2026-10-25', item_ids: ['h', 'b'] },
      { kind: 'history', date: '2026-10-24', item_ids: ['h', 'b'], title: null },
      { kind: 'restart', date: '2026-10-25', today: '2026-10-24', refused: [] },
    ]);
    expect(isChoiceJob(today)).toBe(true);
    expect(isChoiceJob(job('1'))).toBe(false);
    expect(pendingChoices([{ ...today, body: { ...today.body, title: 'Pull et jean' } }])).toEqual([
      { kind: 'history', date: '2026-10-24', item_ids: ['h', 'b'], title: 'Pull et jean' },
    ]);
    expect(pendingChoices([restart, plan]).map((choice) => choice.kind)).toEqual(['restart', 'plan']);
    expect(pendingChoices([{ ...plan, body: { date: '2026-10-25', item_ids: 'x', target: 'plan' } }])).toEqual([]);
  });

  it('liste les pièces des refus encore dans la file', () => {
    expect(pendingRefusalIds([job('1'), job('2'), { ...ACCEPT, id: 'a', attempts: 0 }])).toEqual([['1'], ['2']]);
  });

  it('un second « recommencer » du même jour garde les refus nommés par le premier', () => {
    const first = job('r1', 'recommencer:2026-10-24', {
      endpoint: '/api/miroir/recommencer',
      body: { date: '2026-10-24', today: '2026-10-24', refused: [['a'], ['b']] },
    });
    const second = job('r2', 'recommencer:2026-10-24', {
      endpoint: '/api/miroir/recommencer',
      body: { date: '2026-10-24', today: '2026-10-24', refused: [['b'], ['c']] },
    });
    const jobs = enqueue(enqueue([job('x')], first), second);
    expect(jobs.map((entry) => entry.id)).toEqual(['x', 'r2']);
    expect(jobs[1].body.refused).toEqual([['a'], ['b'], ['c']]);
    // Une autre requête de même clé est remplacée telle quelle.
    expect(enqueue([job('1', 'k')], job('2', 'k'))[0].body).toEqual({ item_ids: ['2'] });
  });

  it('accepter → recommencer → accepter : la dernière tenue acceptée part après le « recommencer »', () => {
    const restart = job('r', 'recommencer:2026-10-25', { endpoint: '/api/miroir/recommencer' });
    let jobs = enqueue([], job('a1', 'accepter:plan:2026-10-25', { endpoint: '/api/miroir/accepter' }));
    jobs = enqueue(jobs, restart);
    jobs = enqueue(jobs, job('a2', 'accepter:plan:2026-10-25', { endpoint: '/api/miroir/accepter' }));
    expect(jobs.map((entry) => entry.id)).toEqual(['r', 'a2']);
  });

  it('trouve la correspondance de touches en attente', () => {
    expect(pendingKeyMapBody([job('1')])).toBeUndefined();
    const keys = job('2', 'touches', { endpoint: '/api/miroir/touches', body: { keyMap: { next: 1 } } });
    expect(pendingKeyMapBody([job('1'), keys])).toEqual({ next: 1 });
  });
});

describe('createQueue', () => {
  it('envoie tout de suite, en POST JSON keepalive, puis vide la file', async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 200 });
    const storage = memoryStorage();
    const queue = createQueue({ fetch, storage, makeId: counter() });
    queue.push(ACCEPT);
    await queue.flush();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/miroir/accepter');
    expect(init).toMatchObject({ method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(init.body)).toEqual(ACCEPT.body);
    expect(queue.jobs()).toEqual([]);
    expect(JSON.parse(storage.data[QUEUE_STORAGE_KEY])).toEqual([]);
  });

  it('sans réseau, garde la requête (localStorage) et la renvoie plus tard', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const storage = memoryStorage();
    const queue = createQueue({ fetch, storage, makeId: counter() });
    queue.push(ACCEPT);
    await queue.flush();
    expect(queue.jobs()).toHaveLength(1);
    expect(queue.jobs()[0].attempts).toBe(0);
    expect(parseStoredQueue(storage.data[QUEUE_STORAGE_KEY])).toHaveLength(1);

    // Rechargement de la page : une nouvelle file relit localStorage.
    const online = vi.fn().mockResolvedValue({ status: 200 });
    const reloaded = createQueue({ fetch: online, storage });
    expect(reloaded.jobs()).toHaveLength(1);
    await reloaded.flush();
    expect(online).toHaveBeenCalledTimes(1);
    expect(reloaded.jobs()).toEqual([]);
  });

  it('garde l’ordre : s’arrête à la première requête à réessayer', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ status: 503 }).mockResolvedValue({ status: 200 });
    const queue = createQueue({ fetch, storage: null, makeId: counter() });
    queue.push(ACCEPT);
    queue.push({ endpoint: '/api/miroir/refuser', body: { item_ids: ['b'] }, dedupeKey: 'refuser:b' });
    await queue.flush();
    await queue.flush();
    expect(queue.jobs()).toEqual([]);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      '/api/miroir/accepter',
      '/api/miroir/accepter',
      '/api/miroir/refuser',
    ]);
  });

  it('abandonne une requête refusée (4xx) pour ne pas réessayer sans fin', async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 400 });
    const queue = createQueue({ fetch, storage: null, makeId: counter() });
    queue.push(ACCEPT);
    await queue.flush();
    expect(queue.jobs()).toEqual([]);
  });

  it('abandonne après MAX_SERVER_ATTEMPTS erreurs du serveur', async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 500 });
    const queue = createQueue({ fetch, storage: null, makeId: counter() });
    queue.push(ACCEPT);
    for (let i = 0; i < MAX_SERVER_ATTEMPTS + 2; i++) await queue.flush();
    expect(queue.jobs()).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(MAX_SERVER_ATTEMPTS);
  });

  it('marche sans localStorage, et même si localStorage lève une erreur', async () => {
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const fetch = vi.fn().mockResolvedValue({ status: 200 });
    const queue = createQueue({ fetch, storage: throwing, makeId: counter() });
    queue.push(ACCEPT);
    await queue.flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(queue.jobs()).toEqual([]);
  });

  it('un seul envoi à la fois, et une requête ajoutée pendant l’envoi part aussi', async () => {
    let release: (value: { status: number }) => void = () => {};
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
      .mockResolvedValue({ status: 200 });
    const queue = createQueue({ fetch, storage: null, makeId: counter() });
    queue.push(ACCEPT);
    queue.push({ endpoint: '/api/miroir/refuser', body: { item_ids: ['b'] }, dedupeKey: 'refuser:b' });
    expect(fetch).toHaveBeenCalledTimes(1);
    release({ status: 200 });
    await queue.flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(queue.jobs()).toEqual([]);
  });
});
