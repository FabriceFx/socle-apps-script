/**
 * Socle — feuilles de calcul. Introduit en v0.1.
 *
 * Quatre règles, toutes payées au moins une fois, que ce module rend
 * difficiles à enfreindre :
 *
 *   - **les colonnes se retrouvent par en-tête**, jamais par indice en dur :
 *     l'ordre des colonnes change, et une colonne insérée à la main par un
 *     utilisateur ne doit décaler aucune écriture ;
 *   - **on écrit par lots**, jamais cellule par cellule ;
 *   - **le référentiel n'est pas dans le code** : ce qui relève du jugement
 *     vit dans un onglet, et le code n'y ajoute que ce qui manque — il ne
 *     réécrit jamais une décision humaine ;
 *   - **un onglet déjà présent mais vide n'est pas un onglet absent.** Les
 *     confondre laisse un onglet sans en-tête, et la première clé se retrouve
 *     en ligne 1 où elle sera prise pour un titre de colonne et ignorée.
 *
 * Ce fichier se recopie tel quel. Il ne dépend d'aucun autre module du socle.
 */

const SOCLE_FEUILLES_VERSION_ = '0.12.2';

/**
 * Noms que Google donne à la feuille d'un classeur neuf.
 *
 * La liste n'a pas à être exhaustive, et ce n'est pas grave : **c'est le
 * contrôle de vacuité qui protège, pas le nom.** Un nom oublié laisse un
 * onglet vide de trop — sans conséquence. Une suppression de trop perdrait des
 * données. Le défaut penche donc du bon côté.
 */
// « Feuil1 » est le nom par défaut d'Excel en français : celui d'un .xlsx importé.
const SOCLE_FEUILLES_PAR_DEFAUT_ = /^(feuil(le)?|sheet|hoja|blatt|foglio|folha)\s?1$/i;

const socleFeuillesClasseur_ = () => SpreadsheetApp.getActive();

/**
 * Résout un onglet désigné par son nom.
 *
 * **Écrire crée, lire ne crée pas**, et l'asymétrie est voulue : écrire dans
 * un onglet neuf est l'usage normal, tandis que lire un onglet absent est
 * presque toujours une faute de frappe ou une installation incomplète — la
 * créer à la volée rendrait un tableau vide qu'on prendrait pour « aucune
 * donnée » au lieu de « mauvais onglet ».
 */
const socleFeuillesResoudre_ = (feuilleOuNom, options = {}) => {
  if (typeof feuilleOuNom !== 'string') return feuilleOuNom;
  const feuille = socleFeuillesClasseur_().getSheetByName(feuilleOuNom);
  if (feuille) return feuille;
  if (options.creerSiAbsent) return socleFeuillesClasseur_().insertSheet(feuilleOuNom);
  throw new Error(`L'onglet « ${feuilleOuNom} » n'existe pas. `
    + 'Vérifiez son nom, ou lancez l\'installation qui le pose.');
};

const SocleFeuilles = {
  version: SOCLE_FEUILLES_VERSION_,

  /**
   * Rend l'onglet, et le crée s'il manque.
   *
   * Rend aussi `{ cree: true }` par le second élément, pour que l'appelant
   * sache s'il vient de le poser — c'est ce qui permet de n'écrire les
   * valeurs d'exemple qu'une seule fois dans la vie du classeur.
   */
  onglet: (nom, options = {}) => {
    const classeur = socleFeuillesClasseur_();
    const existante = classeur.getSheetByName(nom);
    if (existante) return { feuille: existante, cree: false };
    if (options.creerSiAbsent === false) {
      throw new Error(`L'onglet « ${nom} » n'existe pas. `
        + 'Vérifiez son nom, ou appelez onglet() sans creerSiAbsent: false.');
    }
    return { feuille: classeur.insertSheet(nom), cree: true };
  },

  /**
   * Lit tout un onglet en lignes indexées par le nom de colonne.
   *
   * Une seule lecture en bloc, jamais cellule par cellule. Chaque ligne porte
   * son `numero` dans l'onglet, sans quoi l'appelant ne saurait pas où
   * réécrire — et recalculer ce numéro plus tard est la façon la plus sûre
   * de se tromper d'une ligne.
   *
   * Les valeurs sont rendues **brutes** : une cellule de date rend un objet
   * `Date`. La normalisation appartient à l'appelant (module des dates du
   * socle), pour que ce module n'impose rien sur la forme des données.
   */
  lireTable: (feuilleOuNom) => {
    const feuille = socleFeuillesResoudre_(feuilleOuNom);
    const hauteur = feuille.getLastRow();
    const largeur = feuille.getLastColumn();
    if (hauteur < 1 || largeur < 1) return { feuille, entete: [], index: {}, lignes: [] };

    const valeurs = feuille.getRange(1, 1, hauteur, largeur).getValues();
    const entete = valeurs[0].map((titre) => String(titre ?? '').trim());
    const index = {};
    entete.forEach((nom, position) => {
      if (nom !== '' && !(nom in index)) index[nom] = position;
    });

    const lignes = valeurs.slice(1).map((cellules, rang) => {
      const ligne = { numero: rang + 2, cellules };
      Object.keys(index).forEach((nom) => { ligne[nom] = cellules[index[nom]]; });
      return ligne;
    });

    return { feuille, entete, index, lignes };
  },

  /**
   * Position d'une colonne, ou une exception qui dit laquelle manque.
   *
   * Un `undefined` silencieux se transforme en lecture de la colonne A —
   * c'est-à-dire en données fausses qui ont l'air justes.
   */
  colonne: (table, nom) => {
    if (!(nom in table.index)) {
      throw new Error(
        `La colonne « ${nom} » est absente de l'onglet « ${table.feuille.getName()} ». `
        + `Colonnes présentes : ${table.entete.filter((e) => e !== '').join(', ')}. `
        + 'Vérifiez l\'orthographe de l\'en-tête, ou ajoutez la colonne manquante.');
    }
    return table.index[nom];
  },

  /** Écrit un en-tête et des lignes en une seule opération. */
  ecrireTable: (feuilleOuNom, entete, lignes, options = {}) => {
    const feuille = socleFeuillesResoudre_(feuilleOuNom, { creerSiAbsent: true });
    if (options.vider !== false) feuille.clear();
    feuille.getRange(1, 1, 1, entete.length).setValues([entete]).setFontWeight('bold');
    if (lignes.length > 0) {
      const corps = lignes.map((ligne) => (Array.isArray(ligne)
        ? ligne
        : entete.map((nom) => (ligne[nom] === undefined || ligne[nom] === null ? '' : ligne[nom]))));
      feuille.getRange(2, 1, corps.length, entete.length).setValues(corps);
    }
    feuille.setFrozenRows(1);
    return { lignes: lignes.length };
  },

  /**
   * Ajoute les colonnes apparues après coup à un onglet déjà rempli, de façon
   * purement additive.
   *
   * Sans cela, une colonne nouvelle n'existerait que sur les classeurs neufs
   * et resterait invisible à ceux qui en ont justement besoin.
   */
  completerColonnes: (feuilleOuNom, colonnes) => {
    const table = SocleFeuilles.lireTable(feuilleOuNom);
    const manquantes = colonnes.filter((nom) => !(nom in table.index));
    if (manquantes.length === 0) return { ajoutees: [] };
    const depart = Math.max(table.entete.length, 1) + (table.entete.length === 0 ? 0 : 1);
    table.feuille.getRange(1, depart, 1, manquantes.length)
      .setValues([manquantes]).setFontWeight('bold');
    return { ajoutees: manquantes };
  },

  /**
   * Pose une liste déroulante sur la valeur d'un réglage, trouvé **par sa
   * clé**.
   *
   * Jamais par numéro de ligne : une ligne insérée à la main par
   * l'utilisateur déplacerait la validation sur le mauvais réglage, et c'est
   * le genre de défaut qu'on ne voit qu'une fois qu'il a fait choisir la
   * mauvaise valeur à quelqu'un.
   *
   * `bloquant` décide de ce qu'il advient d'une saisie hors liste. Pour un
   * ensemble fermé — Oui / Non — bloquer est juste. Pour une liste tirée d'une
   * API — les modèles disponibles — **avertir sans bloquer** : la liste peut
   * dater, et un nom valide apparu depuis ne doit pas être refusé. Le défaut
   * est donc de ne pas bloquer.
   */
  listeSurReglage: (nom, cle, valeurs, options = {}) => {
    const feuille = socleFeuillesResoudre_(nom);
    const hauteur = Math.max(feuille.getLastRow(), 1);
    const cles = feuille.getRange(1, 1, hauteur, 1).getValues()
      .map((r) => String(r[0] ?? '').trim());
    const rang = cles.indexOf(String(cle).trim());
    if (rang === -1) {
      throw new Error(
        `Aucun réglage nommé « ${cle} » dans l'onglet « ${feuille.getName()} ». `
        + 'Posez le réglage avant sa liste, ou vérifiez son orthographe.');
    }
    const regle = SpreadsheetApp.newDataValidation()
      .requireValueInList(valeurs, true)
      .setAllowInvalid(options.bloquant !== true)
      .build();
    feuille.getRange(rang + 1, 2).setDataValidation(regle);
    return { ligne: rang + 1, valeurs: valeurs.length };
  },

  /**
   * Impose un nombre dans un intervalle sur la valeur d'un réglage.
   *
   * Une liste déroulante quand l'ensemble est fini et court ; un intervalle
   * quand il ne l'est pas. Dérouler cent valeurs n'aide personne.
   */
  nombreSurReglage: (nom, cle, min, max) => {
    const feuille = socleFeuillesResoudre_(nom);
    const hauteur = Math.max(feuille.getLastRow(), 1);
    const cles = feuille.getRange(1, 1, hauteur, 1).getValues()
      .map((r) => String(r[0] ?? '').trim());
    const rang = cles.indexOf(String(cle).trim());
    if (rang === -1) {
      throw new Error(
        `Aucun réglage nommé « ${cle} » dans l'onglet « ${feuille.getName()} ». `
        + 'Posez le réglage avant sa contrainte, ou vérifiez son orthographe.');
    }
    const regle = SpreadsheetApp.newDataValidation()
      .requireNumberBetween(min, max)
      .setAllowInvalid(false)
      .setHelpText(`Un nombre entre ${min} et ${max}.`)
      .build();
    feuille.getRange(rang + 1, 2).setDataValidation(regle);
    return { ligne: rang + 1, min, max };
  },

  /** Pose une liste déroulante sur toute une colonne d'un tableau, en-tête exclu. */
  listeSurColonne: (nom, nomColonne, valeurs, options = {}) => {
    const table = SocleFeuilles.lireTable(nom);
    const position = SocleFeuilles.colonne(table, nomColonne);
    const regle = SpreadsheetApp.newDataValidation()
      .requireValueInList(valeurs, true)
      .setAllowInvalid(options.bloquant !== true)
      .build();
    const hauteur = Math.max(table.lignes.length, options.lignes || 500);
    table.feuille.getRange(2, position + 1, hauteur, 1).setDataValidation(regle);
    return { colonne: position + 1, lignes: hauteur };
  },

  /**
   * Retire la feuille vide que Google pose dans un classeur neuf.
   *
   * À appeler **après** avoir créé ses propres onglets : un classeur ne peut
   * pas rester sans feuille, et Sheets refuse de supprimer la dernière.
   *
   * Trois conditions, et les deux dernières sont les gardes :
   *
   *   - le nom ressemble à celui d'une feuille par défaut ;
   *   - **la feuille est vide** — `getLastRow()` et `getLastColumn()` à zéro.
   *     Une feuille par défaut où quelqu'un a écrit n'est plus une feuille par
   *     défaut, c'est le travail de quelqu'un ;
   *   - **il reste au moins une autre feuille** après.
   *
   * Rend les noms retirés, pour que l'installation puisse le dire plutôt que
   * de faire disparaître un onglet sans un mot.
   */
  retirerFeuilleParDefaut: () => {
    const classeur = socleFeuillesClasseur_();
    const retirees = [];
    classeur.getSheets().forEach((feuille) => {
      if (classeur.getSheets().length <= 1) return;
      const nom = feuille.getName();
      if (!SOCLE_FEUILLES_PAR_DEFAUT_.test(nom)) return;
      if (feuille.getLastRow() !== 0 || feuille.getLastColumn() !== 0) return;
      classeur.deleteSheet(feuille);
      retirees.push(nom);
    });
    return { retirees };
  },

  /**
   * Lit un onglet de réglages en objet clé → valeur (colonnes A et B).
   *
   * Ne lève jamais : un onglet absent ou incomplet rend un objet vide plutôt
   * qu'une exception, pour qu'une installation puisse le compléter.
   */
  lireReglages: (nom) => {
    const feuille = socleFeuillesClasseur_().getSheetByName(nom);
    if (!feuille || feuille.getLastRow() < 2) return {};
    const valeurs = feuille.getRange(1, 1, feuille.getLastRow(), 2).getValues();
    const lu = {};
    valeurs.slice(1).forEach(([cle, valeur]) => {
      const clef = String(cle ?? '').trim();
      if (clef !== '') lu[clef] = valeur;
    });
    return lu;
  },

  /**
   * Écrit un réglage **par sa clé**, jamais par numéro de ligne.
   *
   * Une ligne insérée à la main par l'utilisateur ne doit jamais décaler une
   * écriture automatique. La clé absente est ajoutée à la fin.
   */
  ecrireReglage: (nom, cle, valeur) => {
    const { feuille } = SocleFeuilles.onglet(nom);
    const hauteur = Math.max(feuille.getLastRow(), 1);
    const cles = feuille.getRange(1, 1, hauteur, 1).getValues().map((r) => String(r[0] ?? '').trim());
    const rang = cles.indexOf(String(cle).trim());
    const ligne = rang === -1 ? hauteur + 1 : rang + 1;
    feuille.getRange(ligne, 1, 1, 2).setValues([[cle, valeur]]);
    return { ligne, ajoutee: rang === -1 };
  },

  /**
   * Pose les réglages qui manquent, sans jamais toucher à ceux qui existent.
   *
   * C'est la différence entre compléter et réécrire : le code n'a pas à
   * défaire une décision humaine, même pour la « corriger ».
   */
  completerReglages: (nom, defauts) => {
    const presents = SocleFeuilles.lireReglages(nom);
    const poses = [];
    Object.keys(defauts).forEach((cle) => {
      if (cle in presents && String(presents[cle] ?? '') !== '') return;
      SocleFeuilles.ecrireReglage(nom, cle, defauts[cle]);
      poses.push(cle);
    });
    return { poses };
  },
};
