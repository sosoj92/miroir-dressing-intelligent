// Boutons du téléphone : trois recettes, une par rôle, pas plus.
// 1. Plein (rounded-xl bg-accent, semibold) : l'unique action d'un écran (« Prendre une photo »,
//    « Choisir un fichier », « Se connecter », « Tout est lavé »). Désactivé : opacity-60.
// 2. Ligne d'encart (<Group> et centeredButtonRowClass, components/gestion/group.tsx), 44 px, en
//    écriture normale : prune quand il ajoute ou ouvre (« Choisir dans la galerie »), de la couleur du
//    texte quand il efface (« Supprimer ce vêtement », « Recommencer le choix »). Désactivé : opacity-60,
//    comme un interrupteur ou un contrôle segmenté.
// 3. Texte (min-h-11 text-body text-accent, avec pressFeedback) : en écriture normale, en gras
//    seulement pour l'action qui valide (« Enregistrer », « OK », « Garder pour demain »). Désactivé :
//    disabled:text-muted, il passe en gris sans pâlir.

/**
 * Retour au toucher d'une photo ou d'un bouton texte, comme sur iPhone : il pâlit un instant sous
 * le doigt, et l'on sait que l'appui est pris pendant que l'écran suivant arrive. Les lignes de liste
 * gardent leur fond touché (active:bg-fill). Sans dépassement ni changement d'échelle.
 */
export const pressFeedback = 'transition-opacity duration-100 ease-standard active:opacity-60';
