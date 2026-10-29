// Vignette dont l'URL signée a expiré avant son chargement : image en différé (loading="lazy"),
// ou d'une catégorie choisie longtemps après l'ouverture de la page. La page est alors relue
// (router.refresh()) : le serveur re-signe tout chemin dont l'URL n'est plus resservie, et c'est
// le cas d'une URL expirée, resservie seulement pendant la première moitié de sa vie
// (lib/server/display-urls.ts). Fonction pure, sans réseau.

/** Attente avant de relire la page : les vignettes d'une même catégorie échouent ensemble. */
export const IMAGE_RETRY_DELAY_MS = 300;

/**
 * Renvoie la fonction à appeler avec l'adresse d'une image en échec. `refresh` n'est appelé
 * qu'une fois pour les échecs d'un même moment (`defer`), et une adresse ne le relance qu'une
 * fois : une image vraiment absente ne fait pas relire la page en boucle. Un aperçu local
 * (blob:, data:) n'a rien à re-signer.
 */
export function expiredImageRetry(refresh: () => void, defer: (run: () => void) => void): (src: string) => void {
  const tried = new Set<string>();
  let scheduled = false;
  return (src) => {
    if (!src.startsWith('https://') && !src.startsWith('http://')) return;
    if (tried.has(src)) return;
    tried.add(src);
    if (scheduled) return;
    scheduled = true;
    defer(() => {
      scheduled = false;
      refresh();
    });
  };
}
