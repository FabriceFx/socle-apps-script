/**
 * Socle — secrets et clés d'API. Introduit en v0.6.
 *
 * La mesure ne dit pas ce qu'on croyait. **Aucun secret n'est écrit en dur**
 * dans les six projets — la discipline est là. Ce qu'elle dit est plus
 * discret : sur 43 accès aux propriétés, 39 vont au magasin **de script**,
 * 4 au magasin **de document**, et **aucun** au magasin **de personne**.
 *
 * Or les trois ne protègent pas les mêmes choses :
 *
 *   partagee   PropertiesService.getScriptProperties()
 *              Un seul magasin pour tout le projet. Ce qu'une personne y
 *              écrit, toute exécution du script peut le lire — y compris
 *              celle d'une autre personne, sur une application web déployée
 *              en « exécuter en tant que l'utilisateur qui accède ».
 *   document   getDocumentProperties()
 *              Attaché au classeur. Le bon choix pour un réglage qui décrit
 *              ce document-ci.
 *   personne   getUserProperties()
 *              Isolé par utilisateur. **Le seul qui convienne à un jeton, un
 *              mot de passe ou un consentement personnel** : l'isolation
 *              devient structurelle au lieu de dépendre de la discipline du
 *              code qui lit.
 *
 * Le choix n'a aucun effet visible tant que rien ne fuit, et c'est bien le
 * problème : on ne découvre s'être trompé qu'au moment où il est trop tard.
 * D'où la seule exigence de ce module : **`portee` est obligatoire**. Il n'y a
 * pas de valeur par défaut, parce qu'une valeur par défaut serait la
 * reconduction silencieuse du choix qu'on ne fait pas.
 *
 * Ce fichier se recopie tel quel. Il ne dépend d'aucun autre module du socle.
 */

const SOCLE_SECRETS_VERSION_ = '0.12.2';

const SOCLE_SECRETS_PORTEES_ = ['partagee', 'document', 'personne'];

/** Référentiel des secrets attendus. Objet `const` muté en place. */
const SOCLE_SECRETS_ATTENDUS_ = {};

const socleSecretsTexte_ = (valeur) => String(valeur ?? '').trim();

/**
 * Le magasin d'une portée, ou une exception qui dit pourquoi il n'existe pas.
 *
 * `getDocumentProperties()` rend **null** — il ne lève pas — quand le script
 * n'est lié à aucun document. Sans ce contrôle, l'appelant reçoit un
 * « Cannot read properties of null (reading 'setProperty') » qui ne lui
 * apprend rien. Découvert au premier essai réel, sur un projet autonome.
 */
const socleSecretsMagasin_ = (portee) => {
  const magasin = portee === 'partagee' ? PropertiesService.getScriptProperties()
    : (portee === 'document' ? PropertiesService.getDocumentProperties()
      : PropertiesService.getUserProperties());
  if (!magasin) {
    throw new Error(
      `Le magasin « ${portee} » n'existe pas dans ce contexte : ce script n'est lié à `
      + 'aucun document. Rattachez-le à un classeur, ou déclarez ce secret en portée '
      + '« partagee » (commune à tout le projet) ou « personne » (propre à chacun).');
  }
  return magasin;
};

const socleSecretsDefinition_ = (nom) => {
  const clef = socleSecretsTexte_(nom);
  const definition = SOCLE_SECRETS_ATTENDUS_[clef];
  if (!definition) {
    throw new Error(
      `Le secret « ${clef} » n'a pas été déclaré. `
      + 'Déclarez-le au chargement du projet avec SocleSecrets.declarer({ nom, portee, '
      + 'description }), pour que son emplacement soit écrit quelque part.');
  }
  return definition;
};

const SocleSecrets = {
  version: SOCLE_SECRETS_VERSION_,
  portees: SOCLE_SECRETS_PORTEES_,

  /**
   * Déclare un secret attendu, et où il vit.
   *
   * La déclaration n'écrit rien : elle dit ce que le projet attend, pour que
   * `inventaire()` puisse répondre « manquante » plutôt que de laisser un
   * appel échouer plus tard, loin de sa cause.
   *
   * `description` est obligatoire elle aussi : c'est ce qui s'affiche à qui
   * doit renseigner la valeur, et « CLE_API » tout seul n'a jamais appris à
   * personne où aller la chercher.
   */
  declarer: ({ nom, portee, description, obligatoire }) => {
    const clef = socleSecretsTexte_(nom);
    if (clef === '') {
      throw new Error('SocleSecrets.declarer attend un nom. Renseignez « nom ».');
    }
    if (!SOCLE_SECRETS_PORTEES_.includes(portee)) {
      throw new Error(
        `Le secret « ${clef} » doit dire à qui il appartient. Renseignez « portee » avec `
        + `l'une de ces valeurs : ${SOCLE_SECRETS_PORTEES_.join(', ')}. `
        + '« personne » pour un jeton ou un consentement individuel, « document » pour '
        + 'un réglage propre à ce classeur, « partagee » pour une clé de service '
        + 'commune à toute l\'organisation.');
    }
    const texte = socleSecretsTexte_(description);
    if (texte === '') {
      throw new Error(
        `Le secret « ${clef} » doit porter une description. Indiquez où l'obtenir : `
        + 'c\'est ce que lira la personne chargée de le renseigner.');
    }
    SOCLE_SECRETS_ATTENDUS_[clef] = {
      nom: clef, portee, description: texte, obligatoire: obligatoire !== false,
    };
    return SOCLE_SECRETS_ATTENDUS_[clef];
  },

  /**
   * Lit un secret. Lève en disant où le renseigner s'il manque.
   *
   * Le message nomme le magasin : sans cela, on cherche dans les propriétés du
   * script une valeur qui n'y sera jamais, parce qu'elle vit dans celles de
   * l'utilisateur.
   */
  lire: (nom) => {
    const definition = socleSecretsDefinition_(nom);
    const valeur = socleSecretsMagasin_(definition.portee).getProperty(definition.nom);
    if (valeur === null || valeur === '') {
      if (!definition.obligatoire) return '';
      throw new Error(
        `Le secret « ${definition.nom} » n'est pas renseigné (${definition.description}). `
        + `Renseignez-le dans les propriétés « ${definition.portee} » du projet : `
        + 'Paramètres du projet, puis Propriétés du script — ou par '
        + `SocleSecrets.ecrire('${definition.nom}', …) depuis l'éditeur.`);
    }
    return valeur;
  },

  ecrire: (nom, valeur) => {
    const definition = socleSecretsDefinition_(nom);
    const contenu = String(valeur ?? '');
    // 9 Ko par valeur : la limite se heurte silencieusement sur un certificat
    // ou un jeton de service un peu long.
    if (contenu.length > 9000) {
      throw new Error(
        `Le secret « ${definition.nom} » dépasse les 9 Ko qu'une propriété accepte. `
        + 'Rangez-le dans un fichier Drive à accès restreint, et gardez ici son '
        + 'identifiant.');
    }
    socleSecretsMagasin_(definition.portee).setProperty(definition.nom, contenu);
    return { nom: definition.nom, portee: definition.portee };
  },

  oublier: (nom) => {
    const definition = socleSecretsDefinition_(nom);
    socleSecretsMagasin_(definition.portee).deleteProperty(definition.nom);
    return { nom: definition.nom, portee: definition.portee };
  },

  /**
   * Ce qu'on peut montrer sans rien révéler : quatre caractères au plus, et
   * seulement si la valeur est assez longue pour qu'ils n'en disent rien.
   *
   * À utiliser partout où un secret risque d'atterrir dans un journal. Un
   * jeton journalisé une fois est un jeton à révoquer.
   */
  masquer: (valeur) => {
    const contenu = String(valeur ?? '');
    if (contenu === '') return '';
    if (contenu.length < 12) return '••••';
    return `••••${contenu.slice(-4)}`;
  },

  /**
   * État de tous les secrets déclarés, **sans aucune valeur**.
   *
   * Destiné à un onglet de diagnostic ou à une page d'administration : on doit
   * pouvoir répondre « la clé est bien renseignée » sans la faire apparaître.
   * C'est l'honnêteté du rapport appliquée aux secrets — dire ce qu'on sait,
   * sans dire ce qu'on garde.
   */
  inventaire: () => Object.keys(SOCLE_SECRETS_ATTENDUS_).sort().map((clef) => {
    const definition = SOCLE_SECRETS_ATTENDUS_[clef];
    let valeur = null;
    try {
      valeur = socleSecretsMagasin_(definition.portee).getProperty(definition.nom);
    } catch (e) {
      // Magasin inaccessible — par exemple les propriétés de document depuis
      // un script autonome. On le dit plutôt que de conclure « manquante ».
      return { ...definition, etat: 'illisible', apercu: '', detail: e.message };
    }
    const renseigne = valeur !== null && valeur !== '';
    return {
      nom: definition.nom,
      portee: definition.portee,
      description: definition.description,
      obligatoire: definition.obligatoire,
      etat: renseigne ? 'renseignée' : (definition.obligatoire ? 'MANQUANTE' : 'absente'),
      apercu: renseigne ? SocleSecrets.masquer(valeur) : '',
    };
  }),

  /** Oublie le référentiel. Sert au banc, et à un projet qui redéclare tout. */
  reinitialiser: () => {
    Object.keys(SOCLE_SECRETS_ATTENDUS_).forEach((c) => { delete SOCLE_SECRETS_ATTENDUS_[c]; });
  },
};
