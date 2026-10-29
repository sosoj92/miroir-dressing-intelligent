import { describe, expect, it } from 'vitest';
import { afterSignInPath, destination, fromMirrorCookie, keepFromMirror } from './after-sign-in';

// Retour après la connexion : une table fixe, jamais l'adresse reçue.

describe('destination', () => {
  it('« miroir » mène au miroir, tout le reste à l’accueil du téléphone', () => {
    expect(destination('miroir')).toBe('/');
    for (const other of [undefined, null, '', 'Miroir', '/', '//exemple.com', 'https://exemple.com']) {
      expect(destination(other)).toBe('/gestion');
    }
  });
});

describe('afterSignInPath', () => {
  it('ramène au miroir depuis « Se connecter » du miroir', () => {
    expect(afterSignInPath('?depuis=miroir')).toBe('/');
    expect(afterSignInPath(new URLSearchParams('erreur=lien&depuis=miroir'))).toBe('/');
  });

  it("mène à l'accueil du téléphone sans paramètre ou avec toute autre valeur", () => {
    expect(afterSignInPath('')).toBe('/gestion');
    expect(afterSignInPath('?depuis=')).toBe('/gestion');
    expect(afterSignInPath('?depuis=Miroir')).toBe('/gestion');
    expect(afterSignInPath('?depuis=/gestion/reglages')).toBe('/gestion');
    expect(afterSignInPath('?depuis=//exemple.com')).toBe('/gestion');
    expect(afterSignInPath('?depuis=https%3A%2F%2Fexemple.com')).toBe('/gestion');
    expect(afterSignInPath('?next=/')).toBe('/gestion');
  });
});

describe('fromMirrorCookie', () => {
  it('depuis le miroir : « miroir », pour /auth seulement, une heure au plus', () => {
    expect(fromMirrorCookie('?depuis=miroir', true)).toBe(
      'connexion-depuis=miroir; Max-Age=3600; Path=/auth; SameSite=Lax; Secure',
    );
    expect(fromMirrorCookie('?erreur=lien&depuis=miroir', false)).toBe(
      'connexion-depuis=miroir; Max-Age=3600; Path=/auth; SameSite=Lax',
    );
  });

  it('sinon, efface le cookie : jamais la valeur reçue', () => {
    for (const search of ['', '?depuis=//exemple.com', '?depuis=Miroir']) {
      expect(fromMirrorCookie(search, false)).toBe('connexion-depuis=; Max-Age=0; Path=/auth; SameSite=Lax');
    }
  });
});

describe('keepFromMirror', () => {
  it('ajoute « depuis=miroir » à une adresse déjà construite, sinon rien', () => {
    const mirror = new URL('https://exemple.test/connexion?erreur=lien');
    keepFromMirror(mirror, 'miroir');
    expect(mirror.search).toBe('?erreur=lien&depuis=miroir');

    const other = new URL('https://exemple.test/connexion?erreur=lien');
    keepFromMirror(other, 'ailleurs');
    keepFromMirror(other, undefined);
    expect(other.search).toBe('?erreur=lien');
  });
});
