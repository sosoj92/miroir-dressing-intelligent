import type { Metadata } from 'next';
import { PhonePage } from '@/components/gestion/page-shell';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Connexion' };

// Le gabarit des écrans du téléphone, sans retour : le titre est à la même place que partout.
// Le message d'un lien raté (?erreur=) s'écrit dans le formulaire, sous les champs (sign-in-form.tsx) :
// il n'arrive qu'une fois la page chargée et ne doit rien pousser vers le bas.
export default function SignInPage() {
  return (
    <PhonePage title="Connexion" back={null}>
      <SignInForm />
    </PhonePage>
  );
}
