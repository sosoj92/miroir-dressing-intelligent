import { describe, expect, it, vi } from 'vitest';
import { expiredImageRetry } from './image-retry';

const A = 'https://projet.supabase.co/storage/v1/object/sign/items/u/a.png?token=1';
const B = 'https://projet.supabase.co/storage/v1/object/sign/items/u/b.png?token=1';
const A2 = 'https://projet.supabase.co/storage/v1/object/sign/items/u/a.png?token=2';

/** `defer` simulé : les relectures attendent qu'on les lance. */
function setup() {
  const refresh = vi.fn();
  const waiting: Array<() => void> = [];
  const retry = expiredImageRetry(refresh, (run) => waiting.push(run));
  const flush = () => waiting.splice(0).forEach((run) => run());
  return { refresh, retry, flush, waiting };
}

describe('expiredImageRetry', () => {
  it('plusieurs vignettes en échec au même moment : une seule relecture', () => {
    const { refresh, retry, flush, waiting } = setup();
    retry(A);
    retry(B);
    expect(waiting).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
    flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('une adresse ne relance la page qu’une fois (image vraiment absente : pas de boucle)', () => {
    const { refresh, retry, flush } = setup();
    retry(A);
    flush();
    retry(A);
    flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('une nouvelle adresse en échec plus tard (page restée ouverte) relance une relecture', () => {
    const { refresh, retry, flush } = setup();
    retry(A);
    flush();
    retry(A2);
    flush();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('un aperçu local ne relance rien', () => {
    const { refresh, retry, flush, waiting } = setup();
    retry('blob:http://localhost:3000/1234');
    retry('data:image/png;base64,AAAA');
    flush();
    expect(waiting).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });
});
