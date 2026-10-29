import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { LoadError } from '@/components/gestion/load-error';
import { PhonePage } from '@/components/gestion/page-shell';
import { SignedOut } from '@/components/gestion/signed-out';
import { DeleteItem } from '@/components/wardrobe/delete-item';
import { DirtyToggle } from '@/components/wardrobe/dirty-toggle';
import { GridBackLink } from '@/components/wardrobe/grid-back-link';
import { ItemEditor } from '@/components/wardrobe/item-editor';
import { ItemImage } from '@/components/wardrobe/item-image';
import { PhotoActions } from '@/components/wardrobe/photo-actions';
import { SaveButton, SaveSlot } from '@/components/wardrobe/save-slot';
import { errorName } from '@/lib/items/errors';
import { isUploadedPhotoPath } from '@/lib/items/paths';
import { ITEM_COLUMNS, parseItemRow } from '@/lib/items/rows';
import { itemZone } from '@/lib/items/zone';
import { isUuid } from '@/lib/items/validate';
import { checkUser } from '@/lib/server/auth';
import { displayUrls } from '@/lib/server/display-urls';
import { createClient } from '@/lib/supabase/server';

// Fiche d'un vêtement (téléphone) : correction, au sale, détourage, suppression.
export const metadata: Metadata = { title: 'Vêtement' };

/** « Relancer le détourage » et « Changer la photo » appellent fal.ai depuis cette page. */
export const maxDuration = 120;

export default function ItemPage({ params }: PageProps<'/gestion/garde-robe/[id]'>) {
  return (
    // Le titre est le nom de la pièce : il est rendu par ItemDetail, après lecture de la session.
    // « Enregistrer » (ligne retour) n'apparaît qu'avec le formulaire de la fiche (SaveSlot).
    <SaveSlot>
      <PhonePage backLink={<GridBackLink />} action={<SaveButton />}>
        <Suspense fallback={<ItemFallback />}>
          <ItemDetail params={params} />
        </Suspense>
      </PhonePage>
    </SaveSlot>
  );
}

/**
 * En attente : la place du titre et le carré de la photo, sans animation. Le carré a déjà la
 * couleur de la plaque de la photo : pas de flash blanc avant elle.
 */
function ItemFallback() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6">
      <p className="text-title">&nbsp;</p>
      <div className="mx-auto aspect-square w-60 rounded-xl bg-photo" />
    </div>
  );
}

async function ItemDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Avant toute requête : Postgres refuse un uuid mal formé (ce serait une erreur 500).
  if (!isUuid(id)) notFound();

  const check = await checkUser();
  if (!check.ok) {
    return (
      <>
        <h1 className="text-title">Vêtement</h1>
        <SignedOut status={check.status} />
      </>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from('items').select(ITEM_COLUMNS).eq('id', id).maybeSingle();
  if (error) {
    console.error(`Fiche : ${errorName(error)}`);
    return (
      <>
        <h1 className="text-title">Vêtement</h1>
        <LoadError>Ce vêtement n&apos;a pas pu être chargé.</LoadError>
      </>
    );
  }
  const item = parseItemRow(data);
  if (!item) notFound();

  const userId = check.user.id;
  // Un chemin hors du dossier du compte n'est pas signé : la pièce s'affiche sans image.
  const paths = [item.cutout_path, item.photo_path];
  const urls = await displayUrls(supabase, userId, 'items', paths).catch((caught: unknown) => {
    console.error(`Fiche, URL signées : ${errorName(caught)}`);
    return new Map<string, string>();
  });
  const cutoutUrl = item.cutout_path ? (urls.get(item.cutout_path) ?? null) : null;
  const photoUrl = item.photo_path ? (urls.get(item.photo_path) ?? null) : null;
  // Pièce assemblée : la zone de sa photo portée détourée qui la montre (docs/conception.md §4, écran 2).
  const photo = item.assembly ? item.assembly.photo : null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title break-words">{item.name}</h1>

      {/* Groupes espacés de 32 px, comme les réglages d'un iPhone. */}
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          {/* Photo d'environ 240 px de haut : la fiche tient en un écran et demi. Sur la plaque gris
              très foncé, la même en clair et en sombre, comme les tenues de Demain. */}
          <div className="mx-auto w-60">
            {cutoutUrl ? (
              <ItemImage
                src={cutoutUrl}
                alt={item.name}
                fit="contain"
                zone={photo ? { zone: itemZone(item.category, photo), size: photo.size } : null}
                priority
                plate="photo"
              />
            ) : (
              <ItemImage src={photoUrl} alt={item.name} fit="cover" priority plate="photo" />
            )}
          </div>
          {item.cutout_path || item.assembly ? null : (
            <p className="text-center text-footnote text-muted">Photo à refaire</p>
          )}
          <PhotoActions
            itemId={item.id}
            userId={userId}
            // Même règle que redoCutout : seule une photo à plat envoyée par le téléphone se détoure.
            // Jamais une photo portée (pièce assemblée), qui n'est pas une photo à plat.
            canRedoCutout={!item.assembly && isUploadedPhotoPath(userId, item.photo_path)}
            // Même règle que replacePhoto : une pièce assemblée se change en réimportant le paquet.
            canChangePhoto={!item.assembly}
          />
        </div>

        <DirtyToggle id={item.id} dirty={item.dirty} />

        <ItemEditor
          id={item.id}
          draft={{
            name: item.name,
            category: item.category,
            color: item.color,
            warmth: item.warmth,
            styles: item.styles,
            rain_ok: item.rain_ok,
          }}
        />

        <DeleteItem id={item.id} />
      </div>
    </div>
  );
}
