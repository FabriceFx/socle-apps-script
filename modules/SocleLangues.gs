/**
 * Socle — français / English. Introduit en v0.7.
 *
 * 253 occurrences dans deux projets, et deux implémentations qui se
 * contredisent : `t_(langue, cle)` dans l'un, `t_(cle, langue)` dans l'autre.
 * Recopier une ligne de l'un vers l'autre ne lève rien — la fonction cherche
 * une clé nommée « fr » et rend « fr ». C'est le genre de divergence qui ne se
 * voit qu'en production, dans une langue qu'on ne relit pas.
 *
 * Trois décisions, dont deux reprises telles quelles de ces projets parce
 * qu'elles ont été payées :
 *
 *   - **ce qui est structurel ne se traduit pas.** Les en-têtes de colonnes,
 *     les clés de réglage et les valeurs des listes déroulantes restent en
 *     français dans les deux langues : ce sont des identifiants, pas de la
 *     prose. Les traduire obligerait chaque lecture à reconnaître deux jeux de
 *     libellés, pour un gain nul. Ce qui se traduit, c'est ce que l'outil
 *     **dit** ;
 *   - **une langue inconnue retombe sur la langue par défaut**, jamais sur une
 *     exception : une interface ne doit pas disparaître parce qu'un réglage
 *     est mal orthographié ;
 *   - **une clé absente, en revanche, se voit.** Les deux projets rendaient la
 *     clé telle quelle, si bien qu'une faute de frappe s'affichait à
 *     l'utilisateur sans que personne ne le sache. Ici elle rend `⟨cle⟩` — les
 *     chevrons disent « ceci est un défaut », pas « ceci est un libellé » — et
 *     elle est comptée, pour que `bilan()` puisse la nommer.
 *
 * Ce fichier se recopie tel quel. Il ne dépend d'aucun autre module du socle.
 */

const SOCLE_LANGUES_VERSION_ = '0.12.2';

/** Tables de chaînes et compteurs, objet `const` muté en place. */
const SOCLE_LANGUES_ETAT_ = { defaut: 'fr', chaines: {}, manquantes: {} };

const socleLanguesNoter_ = (quoi) => {
  SOCLE_LANGUES_ETAT_.manquantes[quoi] = (SOCLE_LANGUES_ETAT_.manquantes[quoi] || 0) + 1;
};

/**
 * Choisit la forme selon le nombre.
 *
 * **En français, zéro prend le singulier** — « 0 fichier », « 0 personne » —
 * alors que l'anglais le met au pluriel : « 0 files ». C'est la seule règle de
 * pluriel qui sépare vraiment les deux langues ici, et la seule qu'un code
 * écrit en anglais oublie systématiquement.
 */
const socleLanguesForme_ = (langue, compte) => {
  const n = Math.abs(Number(compte) || 0);
  if (langue === 'fr') return n < 2 ? 'un' : 'plusieurs';
  return n === 1 ? 'un' : 'plusieurs';
};

const SocleLangues = {
  version: SOCLE_LANGUES_VERSION_,

  /**
   * Enregistre les tables de chaînes.
   *
   *     SocleLangues.declarer({
   *       defaut: 'fr',
   *       chaines: {
   *         fr: { menuRegenerer: 'Régénérer maintenant',
   *               fichiers: { un: '{compte} fichier', plusieurs: '{compte} fichiers' } },
   *         en: { menuRegenerer: 'Regenerate now',
   *               fichiers: { un: '{compte} file', plusieurs: '{compte} files' } },
   *       },
   *     });
   */
  declarer: ({ defaut, chaines }) => {
    const langueDefaut = String(defaut || '').trim();
    if (langueDefaut === '') {
      throw new Error('SocleLangues.declarer attend une langue par défaut. '
        + 'Renseignez « defaut », par exemple « fr ».');
    }
    if (!chaines || !chaines[langueDefaut]) {
      throw new Error(
        `SocleLangues.declarer : aucune table pour la langue par défaut « ${langueDefaut} ». `
        + 'Renseignez « chaines » avec au moins cette langue — c’est elle qui sert de '
        + 'repli, et une table de repli absente ferait tout retomber sur les chevrons.');
    }
    SOCLE_LANGUES_ETAT_.defaut = langueDefaut;
    SOCLE_LANGUES_ETAT_.chaines = chaines;
    SOCLE_LANGUES_ETAT_.manquantes = {};
    return { langues: Object.keys(chaines), defaut: langueDefaut };
  },

  langues: () => Object.keys(SOCLE_LANGUES_ETAT_.chaines),
  defaut: () => SOCLE_LANGUES_ETAT_.defaut,

  /**
   * Le texte d'une clé, dans une langue.
   *
   * **La langue vient toujours en premier.** Une seule signature pour tout le
   * socle : c'est l'inversion entre deux projets qui a justifié ce module.
   *
   * `valeurs` remplace les `{marqueurs}`. Un marqueur sans valeur reste
   * **visible** dans le texte plutôt que d'être vidé : « Sauvegardé à {heure} »
   * signale un oubli, « Sauvegardé à  » passe inaperçu.
   */
  traduire: (langue, cle, valeurs) => {
    const clef = String(cle ?? '').trim();
    if (clef === '') return '';

    const demandee = SOCLE_LANGUES_ETAT_.chaines[langue];
    const repli = SOCLE_LANGUES_ETAT_.chaines[SOCLE_LANGUES_ETAT_.defaut] || {};
    const table = demandee || repli;

    let entree = table[clef];
    if (entree === undefined && table !== repli) {
      // Traduction absente dans la langue demandée : on retombe sur le défaut,
      // mais on le compte — une langue à moitié traduite doit se voir.
      socleLanguesNoter_(`${langue}:${clef}`);
      entree = repli[clef];
    }

    if (entree === undefined) {
      socleLanguesNoter_(`*:${clef}`);
      return `⟨${clef}⟩`;
    }

    let texte;
    if (typeof entree === 'object' && entree !== null) {
      const compte = valeurs && valeurs.compte;
      if (compte === undefined) {
        socleLanguesNoter_(`compte:${clef}`);
        return `⟨${clef} sans compte⟩`;
      }
      const langueEffective = demandee ? langue : SOCLE_LANGUES_ETAT_.defaut;
      texte = entree[socleLanguesForme_(langueEffective, compte)];
      if (texte === undefined) {
        socleLanguesNoter_(`forme:${clef}`);
        return `⟨${clef}⟩`;
      }
    } else {
      texte = String(entree);
    }

    if (valeurs) {
      Object.keys(valeurs).forEach((marqueur) => {
        texte = texte.split(`{${marqueur}}`).join(String(valeurs[marqueur]));
      });
    }
    return texte;
  },

  /**
   * Compare les tables entre elles.
   *
   * Destiné au banc du projet hôte : `egal(SocleLangues.verifier().completes,
   * true, …)`. Une langue à laquelle il manque trente clés se voit ici, et non
   * quand un anglophone ouvre l'outil.
   */
  verifier: () => {
    const langues = Object.keys(SOCLE_LANGUES_ETAT_.chaines);
    const reference = Object.keys(SOCLE_LANGUES_ETAT_.chaines[SOCLE_LANGUES_ETAT_.defaut] || {});
    const manquantes = {};
    const surnumeraires = {};

    langues.forEach((langue) => {
      if (langue === SOCLE_LANGUES_ETAT_.defaut) return;
      const clefs = Object.keys(SOCLE_LANGUES_ETAT_.chaines[langue] || {});
      const absentes = reference.filter((c) => !clefs.includes(c));
      const enTrop = clefs.filter((c) => !reference.includes(c));
      if (absentes.length) manquantes[langue] = absentes.sort();
      if (enTrop.length) surnumeraires[langue] = enTrop.sort();
    });

    // Une clé pluralisée d'un côté et simple de l'autre rend une phrase juste
    // dans une langue et fausse dans l'autre, sans qu'aucune clé ne manque.
    const formes = [];
    reference.forEach((clef) => {
      const modele = SOCLE_LANGUES_ETAT_.chaines[SOCLE_LANGUES_ETAT_.defaut][clef];
      const pluralise = typeof modele === 'object' && modele !== null;
      langues.forEach((langue) => {
        if (langue === SOCLE_LANGUES_ETAT_.defaut) return;
        const autre = (SOCLE_LANGUES_ETAT_.chaines[langue] || {})[clef];
        if (autre === undefined) return;
        if ((typeof autre === 'object' && autre !== null) !== pluralise) {
          formes.push(`${langue}:${clef}`);
        }
      });
    });

    return {
      completes: Object.keys(manquantes).length === 0
        && Object.keys(surnumeraires).length === 0 && formes.length === 0,
      manquantes, surnumeraires, formes,
    };
  },

  /**
   * Ce qui a manqué pendant l'exécution : clés introuvables, traductions
   * retombées sur le défaut, pluriels appelés sans compte.
   *
   * À joindre au compte rendu d'une génération : une présentation produite avec
   * douze libellés manquants ne doit pas se présenter comme réussie.
   */
  bilan: () => {
    const entrees = Object.keys(SOCLE_LANGUES_ETAT_.manquantes).sort()
      .map((quoi) => ({ quoi, occurrences: SOCLE_LANGUES_ETAT_.manquantes[quoi] }));
    return {
      total: entrees.reduce((somme, e) => somme + e.occurrences, 0),
      entrees,
    };
  },

  oublier: () => {
    const total = SocleLangues.bilan().total;
    SOCLE_LANGUES_ETAT_.manquantes = {};
    return { oubliees: total };
  },

  /**
   * Les chaînes d'une seule langue, résolues, pour les passer au navigateur.
   *
   * Une seule langue : envoyer toute la table obligerait le client à choisir,
   * et deux endroits qui choisissent la langue finissent par ne pas choisir la
   * même.
   */
  pour: (langue) => {
    const table = SOCLE_LANGUES_ETAT_.chaines[langue]
      || SOCLE_LANGUES_ETAT_.chaines[SOCLE_LANGUES_ETAT_.defaut] || {};
    const copie = {};
    Object.keys(table).forEach((clef) => { copie[clef] = table[clef]; });
    return copie;
  },
};
