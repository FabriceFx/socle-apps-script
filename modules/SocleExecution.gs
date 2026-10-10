/**
 * Socle — le plafond des six minutes. Introduit en v0.5.
 *
 * Le motif le plus répandu du corpus : 54 occurrences dans **cinq projets sur
 * six**. Trois primitives qui vont toujours ensemble, et qu'on réécrit chaque
 * fois un peu différemment.
 *
 * Le fait qui commande tout : **une exécution qui atteint six minutes n'est
 * pas interrompue, elle est tuée.** Aucun `catch`, aucun `finally`, aucune
 * écriture de retour. Ce qui n'est pas parti vers Google n'existe pas pour la
 * reprise. Les six minutes valent pour tous les types de compte — les trente
 * minutes qu'on cite encore pour Workspace ont été retirées.
 *
 * Ce module ne sait pas reprendre un travail : il donne de quoi savoir quand
 * s'arrêter, comment ne pas être deux à travailler, et comment se réveiller.
 * Le motif complet « plan puis application » vit dans son propre dépôt, et
 * porte aujourd'hui sa propre copie de ces primitives — les faire converger
 * est une étape à part, qui se vérifiera à son banc.
 *
 * Ce fichier se recopie tel quel. Il ne dépend d'aucun autre module du socle.
 */

const SOCLE_EXECUTION_VERSION_ = '0.12.2';

/** Budget par défaut, sous le plafond : de quoi écrire l'état et rendre la main. */
const SOCLE_EXECUTION_BUDGET_MS_ = 4 * 60 * 1000;

/**
 * Déclencheurs autorisés par utilisateur et par script (page des quotas Apps
 * Script). Un déclencheur ponctuel s'exécute une fois mais **reste inscrit au
 * projet** : une exécution tuée laisse le sien derrière elle, et l'on atteint
 * la limite sans l'avoir vue venir.
 */
const SOCLE_EXECUTION_DECLENCHEURS_MAX_ = 20;

const SocleExecution = {
  version: SOCLE_EXECUTION_VERSION_,

  /**
   * Ouvre un budget de temps.
   *
   *     const budget = SocleExecution.budget();
   *     for (const unite of file) {
   *       if (!budget.permet(dureeUniteMs)) { programmerLaReprise(); break; }
   *       traiter(unite);
   *     }
   *
   * `permet(ms)` et non `reste() > 0` : **on ne démarre pas une unité sur un
   * budget entamé.** Le pari coûte l'exécution entière, alors que la suivante
   * repartira avec ses six minutes. C'est la nuance qui manque à la plupart
   * des boucles écrites à la main.
   */
  budget: (options = {}) => {
    const maximum = options.msMax || SOCLE_EXECUTION_BUDGET_MS_;
    const depart = Date.now();
    return {
      msMax: maximum,
      ecoule: () => Date.now() - depart,
      reste: () => Math.max(0, maximum - (Date.now() - depart)),
      permet: (msNecessaires) => (Date.now() - depart) + (msNecessaires || 0) <= maximum,
      depasse: () => Date.now() - depart > maximum,
    };
  },

  /**
   * Exécute l'opération sous le verrou du document, ou renonce.
   *
   * `getDocumentLock` et non `getScriptLock` : l'état appartient à ce
   * classeur, et deux classeurs n'ont aucune raison de s'attendre.
   *
   * **Attente nulle** : celui qui arrive second n'a rien d'utile à faire, et
   * l'attente ne ferait que consommer son propre budget. Il rend
   * `{ pris: false }` et l'appelant le dit à l'utilisateur.
   *
   * `releaseLock()` dans un `finally`, sans quoi une exception bloquerait
   * toute exécution jusqu'à l'expiration du verrou.
   */
  sousVerrou: (operation) => {
    // `getDocumentLock()` rend **null** — il ne lève pas — quand le script
    // n'est lié à aucun document. Découvert au premier essai réel, sur un
    // projet autonome : « Cannot read properties of null (reading 'tryLock') ».
    //
    // On retombe alors sur le verrou de script, et c'est le bon choix : sans
    // document, il n'y a rien à quoi rattacher l'exclusion, et l'intention —
    // ne pas travailler à deux en même temps — reste entière. Mais on le
    // **dit** dans le résultat, parce qu'une portée d'exclusion silencieusement
    // élargie est exactement le genre de chose qu'on découvre trop tard.
    const documentaire = LockService.getDocumentLock();
    const verrou = documentaire || LockService.getScriptLock();
    const portee = documentaire ? 'document' : 'script';

    if (!verrou) {
      throw new Error(
        'Aucun verrou disponible dans ce contexte : ni document, ni script. '
        + 'Relancez depuis un projet lié à un classeur, ou depuis l\'éditeur.');
    }

    if (!verrou.tryLock(0)) {
      return {
        pris: false,
        portee,
        message: 'Une exécution est déjà en cours sur ce document. Attendez qu\'elle '
          + 'se termine, puis relancez.',
      };
    }
    try {
      return { pris: true, portee, valeur: operation() };
    } finally {
      verrou.releaseLock();
    }
  },

  /** Retire les déclencheurs qui visent cette fonction, et dit combien. */
  retirerReprise: (nomFonction) => {
    let retires = 0;
    ScriptApp.getProjectTriggers().forEach((declencheur) => {
      if (declencheur.getHandlerFunction() === nomFonction) {
        ScriptApp.deleteTrigger(declencheur);
        retires += 1;
      }
    });
    return retires;
  },

  /** Vrai si une reprise est déjà programmée pour cette fonction. */
  repriseProgrammee: (nomFonction) => ScriptApp.getProjectTriggers()
    .some((declencheur) => declencheur.getHandlerFunction() === nomFonction),

  /**
   * Programme une reprise, après avoir ramassé les précédentes.
   *
   * La cible doit être une `function` déclarée du projet : un déclencheur est
   * résolu par son nom global au moment où il se réveille, et rien ne signale
   * l'erreur avant. Vérifier ici coûte une ligne et évite de découvrir
   * « Fonction de script introuvable » dans un journal, une minute plus tard,
   * sans personne pour le lire.
   *
   * Le ramassage se fait à trois endroits, et le troisième est le seul qui
   * opère dans le cas dégradé : avant d'en créer un nouveau (ici), à la fin
   * d'un travail terminé, et **en première ligne de la fonction cible** —
   * celle-là opère quand l'exécution renonce aussitôt, verrou déjà pris.
   */
  programmerReprise: (nomFonction, delaiMs) => {
    SocleExecution.retirerReprise(nomFonction);

    if (typeof globalThis !== 'undefined'
        && typeof globalThis[nomFonction] !== 'function') {
      throw new Error(
        `La reprise vise « ${nomFonction} », qui n'est pas une function déclarée de ce `
        + 'projet : un déclencheur qui la viserait échouerait une minute plus tard, en '
        + 'arrière-plan. Déclarez-la avec « function », et non « const … = () => ».');
    }

    const existants = ScriptApp.getProjectTriggers().length;
    if (existants >= SOCLE_EXECUTION_DECLENCHEURS_MAX_) {
      throw new Error(
        `Ce projet compte déjà ${existants} déclencheurs sur les `
        + `${SOCLE_EXECUTION_DECLENCHEURS_MAX_} autorisés par utilisateur et par script. `
        + 'Supprimez-en avant de relancer.');
    }

    ScriptApp.newTrigger(nomFonction).timeBased().after(delaiMs || 60 * 1000).create();
    return { programmee: true, dans: delaiMs || 60 * 1000 };
  },
};
