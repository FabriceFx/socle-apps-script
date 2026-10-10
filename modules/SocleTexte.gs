/**
 * Socle — texte et échappement. Introduit en v0.1.
 *
 * Tout ce qui part dans du HTML — une boîte de dialogue, une barre latérale,
 * une carte Chat, une application web — passe par ici. Un échappement partiel
 * n'est pas un échappement : une version qui oublie les guillemets laisse
 * passer une injection dès que la valeur atterrit dans un attribut.
 *
 * Ce fichier se recopie tel quel. Il ne dépend d'aucun autre module du socle.
 */

const SOCLE_TEXTE_VERSION_ = '0.12.2';

/**
 * Les cinq remplacements, et pas trois.
 *
 * `&` d'abord, sans quoi les entités produites par les remplacements suivants
 * seraient elles-mêmes échappées. Les deux sortes de guillemets ensuite :
 * elles couvrent le contenu d'un attribut, qu'il soit délimité par `"` ou
 * par `'` — c'est précisément ce qu'oublie un échappement à trois
 * remplacements, et le trou ne se voit qu'une fois exploité.
 */
const SocleTexte = {
  version: SOCLE_TEXTE_VERSION_,

  echapperHtml: (valeur) => String(valeur ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;'),

  /**
   * Rend une URL sûre à poser dans un `href`, ou `''`.
   *
   * Échapper ne suffit pas : `javascript:alert(1)` ne contient aucun caractère
   * à échapper et s'exécute tout de même. On filtre donc le schéma, en
   * n'autorisant que ceux qui ont un sens dans nos interfaces. Une URL
   * relative est acceptée telle quelle.
   */
  urlSure: (valeur) => {
    const texte = String(valeur ?? '').trim();
    if (texte === '') return '';
    const schema = /^([a-z][a-z0-9+.-]*):/i.exec(texte);
    if (schema && !['http', 'https', 'mailto'].includes(schema[1].toLowerCase())) return '';
    return SocleTexte.echapperHtml(texte);
  },

  /**
   * Tronque sans couper au milieu d'un mot quand c'est possible, et **dit
   * qu'il a tronqué**. Un texte coupé en silence se lit comme un texte
   * complet.
   */
  tronquer: (valeur, maximum, suffixe = '…') => {
    const texte = String(valeur ?? '');
    if (texte.length <= maximum) return texte;
    const brut = texte.slice(0, Math.max(0, maximum - suffixe.length));
    const espace = brut.lastIndexOf(' ');
    return `${espace > maximum / 2 ? brut.slice(0, espace) : brut}${suffixe}`;
  },

  /** Réduit les blancs successifs et retire ceux des extrémités. */
  normaliserEspaces: (valeur) => String(valeur ?? '').replace(/\s+/g, ' ').trim(),

  /**
   * Compare deux textes comme le ferait un humain : sans accents, sans casse,
   * sans blancs superflus. Pour rapprocher une saisie libre d'un référentiel,
   * jamais pour en faire une clé de stockage.
   *
   * Table explicite plutôt que `normalize('NFD')` : la décomposition Unicode
   * dépend d'ICU, dont on ne contrôle ni la présence ni la version dans le
   * moteur qui exécutera ce code. Même raison que les noms de mois du module
   * des dates — ce qui doit être déterministe ne se délègue pas à une locale.
   */
  comparable: (valeur) => {
    const accents = 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæ';
    const sans = ['a', 'a', 'a', 'a', 'a', 'a', 'c', 'e', 'e', 'e', 'e', 'i', 'i', 'i', 'i',
      'n', 'o', 'o', 'o', 'o', 'o', 'u', 'u', 'u', 'u', 'y', 'y', 'oe', 'ae'];
    return String(valeur ?? '').toLowerCase()
      .split('')
      .map((c) => {
        const rang = accents.indexOf(c);
        return rang === -1 ? c : sans[rang];
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  },
};
