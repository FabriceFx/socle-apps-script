/**
 * Socle — courriels sortants. Introduit en v0.2.
 *
 * Ce module n'est pas entré ici parce qu'il était réécrit partout : la mesure
 * dit l'inverse — quatre envois dans tout le corpus, et **aucune notification
 * d'erreur**. Il y est entré parce que c'est une absence qui coûte : des
 * outils qui tournent sur déclencheurs, en arrière-plan, sans que personne ne
 * soit prévenu quand ils échouent. Les erreurs partent dans `console.error`,
 * c'est-à-dire dans un journal que personne n'ouvre.
 *
 * L'axe de classement n'est pas la gravité, c'est **ce qu'on attend du
 * destinataire** — rien, un acte, ou une réponse. C'est ce qui décide de tout
 * le reste : ce qui se groupe, ce qui se répète, ce qui a une échéance.
 *
 *   information  on n'attend rien. Se lit, se supprime, se groupe.
 *   erreur       on attend un acte. Doit dire quoi faire, pas ce qui a cassé.
 *   question     on attend une réponse. Sans canal de réponse ni échéance,
 *                ce n'est pas une question : c'est une information déguisée,
 *                et le module refuse de l'envoyer.
 *
 * `MailApp` et non `GmailApp` : il ne sait qu'envoyer, aucune portée de
 * lecture de la messagerie n'est demandée. La portée nécessaire est
 * `https://www.googleapis.com/auth/script.send_mail`.
 *
 * Ce fichier se recopie tel quel. Il ne dépend d'aucun autre module du socle.
 */

const SOCLE_COURRIEL_VERSION_ = '0.13.0';

/**
 * Marqueurs d'objet, pour que le destinataire puisse filtrer.
 *
 * Un administrateur qui reçoit trois natures de messages du même outil a
 * besoin de les trier sans les ouvrir. Le marqueur est en tête de l'objet
 * parce que c'est la seule partie visible dans une notification mobile.
 */
const SOCLE_COURRIEL_MARQUEURS_ = {
  information: 'Info',
  erreur: 'Erreur',
  question: 'Question',
};

/** Silence par défaut entre deux signalements d'une même cause. */
const SOCLE_COURRIEL_SILENCE_MS_ = 6 * 60 * 60 * 1000;

const SOCLE_COURRIEL_PREFIXE_ETAT_ = 'socleCourriel:';

const socleCourrielProprietes_ = () => PropertiesService.getScriptProperties();

const socleCourrielMaintenant_ = () => Date.now();

const socleCourrielTexte_ = (valeur) => String(valeur ?? '').trim();

/**
 * Mémoire d'une cause d'erreur : quand elle a été signalée, combien de fois
 * elle est survenue depuis.
 *
 * Une propriété par cause, et rien d'autre : l'état tient largement sous les
 * 9 Ko par valeur, et une cause disparue cesse simplement d'être relue.
 */
const socleCourrielEtat_ = (cle) => {
  try {
    const brut = socleCourrielProprietes_().getProperty(SOCLE_COURRIEL_PREFIXE_ETAT_ + cle);
    return brut ? JSON.parse(brut) : { signaleeLe: 0, occurrences: 0, depuis: 0 };
  } catch (e) {
    // Propriétés indisponibles : on préfère envoyer en double que se taire.
    return { signaleeLe: 0, occurrences: 0, depuis: 0 };
  }
};

const socleCourrielEnregistrer_ = (cle, etat) => {
  try {
    socleCourrielProprietes_().setProperty(
      SOCLE_COURRIEL_PREFIXE_ETAT_ + cle, JSON.stringify(etat));
  } catch (e) { /* sans mémoire, l'anti-répétition ne s'applique pas : tant pis */ }
};

/**
 * Pied de page commun : d'où vient ce message.
 *
 * Un chiffre s'accompagne toujours de ce qui le produit. Un message
 * automatique sans provenance est un message qu'on ne peut ni recouper ni
 * faire cesser — et qui finira en filtre « supprimer ».
 */
const socleCourrielPied_ = (source) => {
  const lignes = ['', '—'];
  if (source && source.outil) lignes.push(`Envoyé par ${source.outil}`
    + (source.version ? ` (version ${source.version})` : ''));
  if (source && source.lien) lignes.push(source.lien);
  if (source && source.pourquoi) lignes.push(source.pourquoi);
  return lignes.length > 2 ? lignes.join('\n') : '';
};

const socleCourrielEnvoyer_ = (destinataires, objet, corps) => {
  const a = (Array.isArray(destinataires) ? destinataires : [destinataires])
    .map(socleCourrielTexte_).filter((x) => x !== '');
  if (a.length === 0) {
    throw new Error('Aucun destinataire : le message n\'a pas été envoyé. '
      + 'Renseignez « a » avec au moins une adresse.');
  }

  // Le quota se lit avant d'envoyer, plutôt qu'échouer à mi-parcours.
  const reste = MailApp.getRemainingDailyQuota();
  if (reste <= 0) {
    throw new Error('Quota d\'envoi épuisé pour aujourd\'hui : le message n\'est pas parti. '
      + 'Relancez demain, après la remise à zéro quotidienne du quota.');
  }

  MailApp.sendEmail({ to: a.join(','), subject: objet, body: corps });
  return { destinataires: a, objet, quotaRestant: reste - 1 };
};

const SocleCourriel = {
  version: SOCLE_COURRIEL_VERSION_,
  marqueurs: SOCLE_COURRIEL_MARQUEURS_,

  /**
   * Message dont on n'attend rien : un compte rendu, un relevé, une fin de
   * traitement.
   *
   * C'est la catégorie qu'il faut se retenir d'utiliser. Trois informations
   * de trop et le destinataire pose un filtre — qui emportera aussi les
   * erreurs et les questions, puisqu'elles viennent du même expéditeur.
   */
  information: ({ a, objet, corps, source }) => {
    const titre = socleCourrielTexte_(objet);
    if (titre === '') throw new Error('Une information doit porter un objet. Renseignez « objet ».');
    return socleCourrielEnvoyer_(a,
      `[${SOCLE_COURRIEL_MARQUEURS_.information}] ${titre}`,
      `${socleCourrielTexte_(corps)}\n${socleCourrielPied_(source)}`);
  },

  /**
   * Message dont on attend un acte.
   *
   * Trois exigences, et le module refuse d'envoyer sans elles :
   *
   *   - **`quoiFaire` est obligatoire.** Un message d'erreur dit quoi faire
   *     ensuite, pas ce qui a échoué. « Échec de la synchronisation » n'aide
   *     personne ; « le dossier de photos n'est plus partagé avec le compte de
   *     service — repartagez-le, puis relancez » se traite ;
   *   - **`cle` identifie la cause, pas l'occurrence.** On agrège par cause et
   *     non par victime : un manager parti produit une ligne, pas trois cents
   *     messages portant le même défaut ;
   *   - **le silence est borné et avoué.** Une même cause ne repart pas avant
   *     `silenceMs` (six heures par défaut), et le message qui repart dit
   *     combien de fois elle est survenue entre-temps. Un anti-répétition qui
   *     cacherait le volume mentirait sur l'ampleur.
   *
   * `cause` porte le détail technique, en fin de message : le destinataire
   * n'est pas toujours du métier, et ce qu'un utilisateur lit n'est pas ce
   * qu'un administrateur lit.
   */
  erreur: ({ a, quoi, quoiFaire, cause, cle, silenceMs, source }) => {
    const sujet = socleCourrielTexte_(quoi);
    const remede = socleCourrielTexte_(quoiFaire);
    if (sujet === '') {
      throw new Error('Une erreur doit dire ce qui ne va pas. Renseignez « quoi ».');
    }
    if (remede === '') {
      throw new Error(
        'Une erreur doit dire quoi faire ensuite. Sans remède, le message n\'apprend '
        + 'rien à qui le reçoit. Renseignez « quoiFaire » avec le geste attendu.');
    }

    const identifiant = socleCourrielTexte_(cle) || sujet;
    const etat = socleCourrielEtat_(identifiant);
    const maintenant = socleCourrielMaintenant_();
    const silence = silenceMs === undefined ? SOCLE_COURRIEL_SILENCE_MS_ : silenceMs;

    if (etat.signaleeLe && maintenant - etat.signaleeLe < silence) {
      socleCourrielEnregistrer_(identifiant, {
        signaleeLe: etat.signaleeLe,
        occurrences: etat.occurrences + 1,
        depuis: etat.depuis || etat.signaleeLe,
      });
      return { envoye: false, raison: 'silence', occurrences: etat.occurrences + 1 };
    }

    const repetitions = etat.occurrences > 0
      ? `\nCette cause est survenue ${etat.occurrences + 1} fois depuis le dernier signalement.\n`
      : '';

    const corps = [
      sujet,
      '',
      'À faire :',
      remede,
      repetitions,
      cause ? `Détail technique :\n${socleCourrielTexte_(cause)}` : '',
      socleCourrielPied_(source),
    ].filter((bloc) => bloc !== '').join('\n');

    const envoi = socleCourrielEnvoyer_(a,
      `[${SOCLE_COURRIEL_MARQUEURS_.erreur}] ${sujet}`, corps);

    socleCourrielEnregistrer_(identifiant, { signaleeLe: maintenant, occurrences: 0, depuis: 0 });
    return { envoye: true, ...envoi };
  },

  /**
   * Message dont on attend une réponse.
   *
   * `repondreVia` et `avantLe` sont obligatoires, et ce refus est l'essentiel
   * du module : **une question sans canal de réponse ni échéance n'est pas une
   * question**, c'est une information déguisée qui laissera son auteur croire
   * qu'il a demandé quelque chose.
   *
   * Le module n'assure pas le suivi des réponses, et c'est délibéré : lui seul
   * ne peut pas savoir ce qui vaut réponse. Il rend une `reference` que
   * l'appelant consigne là où vit son état — typiquement la ligne d'un plan,
   * qui passera de « À faire » à « Fait » quand la réponse arrivera.
   */
  question: ({ a, objet, question, repondreVia, avantLe, source }) => {
    const titre = socleCourrielTexte_(objet);
    const demande = socleCourrielTexte_(question);
    const canal = socleCourrielTexte_(repondreVia);
    const echeance = socleCourrielTexte_(avantLe);

    if (titre === '' || demande === '') {
      throw new Error('Une question doit porter un objet et une demande. '
        + 'Renseignez « objet » et « question ».');
    }
    if (canal === '') {
      throw new Error(
        'Une question doit dire par où répondre (« repondreVia ») : un lien, un '
        + 'formulaire, une adresse. Sans canal de réponse, ce n\'est pas une question. '
        + 'Renseignez « repondreVia ».');
    }
    if (echeance === '') {
      throw new Error(
        'Une question doit porter une échéance (« avantLe ») : sans elle, personne '
        + 'ne saura qu\'elle est restée sans réponse. Renseignez « avantLe ».');
    }

    const reference = `${SOCLE_COURRIEL_MARQUEURS_.question}-${socleCourrielMaintenant_()}`;
    const corps = [
      demande,
      '',
      `Répondre : ${canal}`,
      `Avant le : ${echeance}`,
      '',
      `Référence : ${reference}`,
      socleCourrielPied_(source),
    ].filter((bloc) => bloc !== '').join('\n');

    const envoi = socleCourrielEnvoyer_(a,
      `[${SOCLE_COURRIEL_MARQUEURS_.question}] ${titre}`, corps);
    return { reference, ...envoi };
  },

  /**
   * Oublie la mémoire d'une cause d'erreur, ou de toutes.
   *
   * Le pendant de « repartir de zéro » : quand une cause est corrigée, on ne
   * veut pas attendre six heures pour être prévenu si elle revient.
   */
  oublierCause: (cle) => {
    const proprietes = socleCourrielProprietes_();
    if (cle) {
      proprietes.deleteProperty(SOCLE_COURRIEL_PREFIXE_ETAT_ + socleCourrielTexte_(cle));
      return { oubliees: 1 };
    }
    const toutes = proprietes.getKeys()
      .filter((k) => k.indexOf(SOCLE_COURRIEL_PREFIXE_ETAT_) === 0);
    toutes.forEach((k) => proprietes.deleteProperty(k));
    return { oubliees: toutes.length };
  },
};
