/**
 * Contrôle du socle, dans Google. Introduit en v0.8.
 *
 * `node banc/test.js` prouve la cohérence interne du socle, hors de Google.
 * Il ne prouve rien de ce que Google fait réellement : que
 * `HtmlService.XFrameOptionsMode` ne comporte bien que deux valeurs, que les
 * trois magasins de propriétés sont bien distincts, que `Utilities.sleep`
 * dort vraiment, que le fuseau du script est celui qu'on croit.
 *
 * Ce fichier répond à cela, et à rien d'autre. On le pose dans le projet
 * Apps Script du socle, on lance `controlerLeSocle` depuis le menu
 * d'exécution, et on lit le journal.
 *
 * **Il ne modifie rien de durable.** Ce qu'il crée — une propriété
 * temporaire, un déclencheur ponctuel — est retiré dans un `finally`, et le
 * rapport dit ce qui a été créé. Il **n'envoie aucun courriel** : seuls les
 * refus de `SocleCourriel` sont éprouvés, qui lèvent avant d'envoyer.
 *
 * Ce qu'il ne peut pas tester, il le dit — « non testable ici » n'est pas
 * « réussi ».
 */

const SOCLE_CONTROLE_VERSION_ = '0.12.2';

/** Préfixe des traces laissées par le contrôle, pour les reconnaître et les retirer. */
const SOCLE_CONTROLE_PREFIXE_ = 'socleControleTemporaire';

/**
 * Les modules présents dans ce projet, nommés un par un.
 *
 * **Pas de `globalThis[nom]`**, et c'est le piège qui a fait échouer la
 * première version de ce fichier : une `const` de portée globale ne devient
 * jamais une propriété de l'objet global. Seules les `function` déclarées et
 * les `var` y arrivent. `globalThis.SocleDates` est donc toujours `undefined`,
 * quand bien même le module est là — et les onze modules étaient annoncés
 * « absents » alors qu'ils étaient tous chargés.
 *
 * Il n'existe pas de détour : il faut nommer chaque identifiant en clair, pour
 * que la recherche soit lexicale. `typeof X` est le seul opérateur qui ne lève
 * pas sur un identifiant jamais déclaré, ce qui rend la table utilisable même
 * dans un projet qui n'embarque qu'une partie du socle.
 */
const socleControleModules_ = () => ({
  SocleApi: typeof SocleApi === 'undefined' ? null : SocleApi,
  SocleCourriel: typeof SocleCourriel === 'undefined' ? null : SocleCourriel,
  SocleDates: typeof SocleDates === 'undefined' ? null : SocleDates,
  SocleErreurs: typeof SocleErreurs === 'undefined' ? null : SocleErreurs,
  SocleExecution: typeof SocleExecution === 'undefined' ? null : SocleExecution,
  SocleFeuilles: typeof SocleFeuilles === 'undefined' ? null : SocleFeuilles,
  SocleLangues: typeof SocleLangues === 'undefined' ? null : SocleLangues,
  SocleReprises: typeof SocleReprises === 'undefined' ? null : SocleReprises,
  SocleSecrets: typeof SocleSecrets === 'undefined' ? null : SocleSecrets,
  SocleTexte: typeof SocleTexte === 'undefined' ? null : SocleTexte,
  SocleWeb: typeof SocleWeb === 'undefined' ? null : SocleWeb,
});

/**
 * Point d'entrée — une `function` déclarée, pour qu'elle apparaisse au menu
 * d'exécution de l'éditeur.
 */
function controlerLeSocle() {
  const lignes = [];
  const traces = [];
  let reussites = 0;
  let echecs = 0;
  let ignores = 0;

  const dire = (etat, module, quoi, detail) => {
    if (etat === 'ok') reussites += 1;
    else if (etat === 'ÉCHEC') echecs += 1;
    else ignores += 1;
    lignes.push(`  ${etat.padEnd(12)} ${module.padEnd(16)} ${quoi}${detail ? ` — ${detail}` : ''}`);
  };

  const presents = socleControleModules_();

  const controler = (module, quoi, essai) => {
    if (!presents[module]) {
      dire('absent', module, quoi, 'module non présent dans ce projet');
      return;
    }
    try {
      const detail = essai();
      dire('ok', module, quoi, detail || '');
    } catch (erreur) {
      dire('ÉCHEC', module, quoi, String((erreur && erreur.message) || erreur).slice(0, 160));
    }
  };

  const nonTestable = (module, quoi, pourquoi) => dire('non testable', module, quoi, pourquoi);

  const affirmer = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  // ---- contexte -----------------------------------------------------------

  let classeur = null;
  try { classeur = SpreadsheetApp.getActive(); } catch (e) { classeur = null; }
  const fuseau = Session.getScriptTimeZone();
  let moi = '';
  try { moi = Session.getEffectiveUser().getEmail(); } catch (e) { moi = '(inconnu)'; }

  lignes.push(`Contrôle du socle ${SOCLE_CONTROLE_VERSION_} — `
    + `${Utilities.formatDate(new Date(), fuseau, 'yyyy-MM-dd HH:mm:ss')}`);
  lignes.push(`  projet ${classeur ? `lié au classeur « ${classeur.getName()} »` : 'autonome (non lié à un classeur)'}`);
  let fuseauClasseur = '';
  try { fuseauClasseur = classeur ? classeur.getSpreadsheetTimeZone() : ''; } catch (e) { fuseauClasseur = ''; }
  lignes.push(`  fuseau du script : ${fuseau}`
    + (fuseauClasseur ? `, du classeur : ${fuseauClasseur}` : ''));
  lignes.push(`  exécuté par : ${moi}`);
  const charges = Object.keys(presents).filter((nom) => presents[nom]);
  const versions = charges.map((nom) => presents[nom].version)
    .filter((v, i, t) => t.indexOf(v) === i);
  lignes.push(`  modules chargés : ${charges.length} sur ${Object.keys(presents).length}`
    + ` (version ${versions.join(' et ')})`);
  const manquants = Object.keys(presents).filter((nom) => !presents[nom]);
  if (manquants.length) lignes.push(`  absents : ${manquants.join(', ')}`);
  lignes.push('');

  try {
    // ---- ce que seul Google peut confirmer --------------------------------

    controler('SocleWeb', 'l’énumération XFrameOptionsMode', () => {
      const modes = HtmlService.XFrameOptionsMode;
      affirmer(typeof modes.ALLOWALL === 'object' || typeof modes.ALLOWALL === 'string',
        'ALLOWALL absent de l’énumération');
      affirmer(typeof modes.DEFAULT === 'object' || typeof modes.DEFAULT === 'string',
        'DEFAULT absent de l’énumération');
      affirmer(modes.DENY === undefined,
        'DENY existe : la documentation du projet doit être corrigée');
      return 'ALLOWALL et DEFAULT présents, DENY bien inexistant';
    });

    controler('SocleWeb', 'inclusion de la feuille de style', () => {
      // clasp pousse un dossier comme un préfixe de nom : « modules/SocleStyle »
      // et non « SocleStyle ». C'est le premier écueil d'un socle rangé en
      // sous-dossier, et il ne se voit qu'ici.
      const noms = ['SocleStyle', 'modules/SocleStyle'];
      const trouve = noms.filter((nom) => {
        try { return SocleWeb.inclure(nom).length > 0; } catch (e) { return false; }
      });
      affirmer(trouve.length > 0,
        `aucun de ces noms ne désigne un fichier : ${noms.join(', ')}. `
        + 'Regardez le nom exact dans l’éditeur, à gauche.');
      return `nom à employer : « ${trouve[0]} »`;
    });

    // Le piège que le premier classeur d'essai a révélé : `clasp create` pose
    // le fuseau par défaut du compte Google, et non celui du classeur. Six
    // heures d'écart, et une date écrite après 18 h se range la veille — en
    // silence, dans une colonne qui se trie.
    if (classeur) {
      controler('SocleDates', 'fuseau du script et du classeur', () => {
        affirmer(fuseau === fuseauClasseur,
          `le script est en ${fuseau}, le classeur en ${fuseauClasseur}. Toute date `
          + 'normalisée par le script sera décalée par rapport à ce que lit l’utilisateur, '
          + 'et changera de jour près de minuit. Corrigez « timeZone » dans '
          + 'appsscript.json, puis poussez de nouveau.');
        return `${fuseau} des deux côtés`;
      });
    } else {
      nonTestable('SocleDates', 'fuseau du script et du classeur',
        'projet autonome : aucun classeur auquel comparer le fuseau du script.');
    }

    controler('SocleDates', 'fuseau réel et aller-retour', () => {
      const maintenant = SocleDates.maintenantHorodatage();
      affirmer(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(maintenant),
        `format inattendu : ${maintenant}`);
      const relu = SocleDates.jour(maintenant);
      affirmer(relu === maintenant.slice(0, 10), `aller-retour faux : ${relu}`);
      return maintenant;
    });

    controler('SocleTexte', 'échappement', () => {
      const attendu = '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;';
      const obtenu = SocleTexte.echapperHtml('<a href="x">&\'</a>');
      affirmer(obtenu === attendu, `obtenu ${obtenu}`);
      return 'les cinq remplacements';
    });

    controler('SocleLangues', 'pluriel français et anglais', () => {
      SocleLangues.declarer({
        defaut: 'fr',
        chaines: {
          fr: { n: { un: '{compte} fichier', plusieurs: '{compte} fichiers' } },
          en: { n: { un: '{compte} file', plusieurs: '{compte} files' } },
        },
      });
      affirmer(SocleLangues.traduire('fr', 'n', { compte: 0 }) === '0 fichier', 'zéro français');
      affirmer(SocleLangues.traduire('en', 'n', { compte: 0 }) === '0 files', 'zéro anglais');
      return 'zéro au singulier en français, au pluriel en anglais';
    });

    controler('SocleErreurs', 'remède obligatoire et absorption comptée', () => {
      let refuse = false;
      try { SocleErreurs.erreur({ quoi: 'x' }); } catch (e) { refuse = true; }
      affirmer(refuse, 'une erreur sans remède aurait dû être refusée');
      SocleErreurs.oublier();
      SocleErreurs.absorber('contrôle', () => { throw new Error('prévu'); }, null);
      affirmer(SocleErreurs.bilan().total === 1, 'l’absorption n’a pas été comptée');
      SocleErreurs.oublier();
      return 'refus et compteur';
    });

    controler('SocleReprises', 'Utilities.sleep dort vraiment', () => {
      const depart = Date.now();
      let essais = 0;
      const valeur = SocleReprises.avecReprises(() => {
        essais += 1;
        if (essais < 3) throw new Error('Internal error, try again');
        return 'abouti';
      });
      const duree = Date.now() - depart;
      affirmer(valeur === 'abouti', 'la reprise n’a pas abouti');
      affirmer(duree >= 2000, `attentes trop courtes : ${duree} ms au lieu d’environ 2400`);
      return `${essais} tentatives, ${duree} ms d’attente réelle`;
    });

    controler('SocleExecution', 'horloge réelle', () => {
      const budget = SocleExecution.budget({ msMax: 60 * 1000 });
      Utilities.sleep(1200);
      affirmer(budget.ecoule() >= 1000, `horloge figée : ${budget.ecoule()} ms`);
      affirmer(!budget.permet(59 * 1000), 'permet() accepte une unité qui ne tient pas');
      return `${budget.ecoule()} ms mesurées après 1200 ms de sommeil`;
    });

    controler('SocleExecution', 'verrou de document', () => {
      const resultat = SocleExecution.sousVerrou(() => 'travail');
      affirmer(resultat.pris === true, `verrou non pris : ${resultat.message || ''}`);
      return classeur ? 'verrou de document obtenu'
        : 'obtenu même en projet autonome (Google rend alors un verrou de script)';
    });

    controler('SocleExecution', 'déclencheur créé puis retiré', () => {
      const poses = ScriptApp.getProjectTriggers().length;
      if (poses >= 19) {
        throw new Error(`${poses} déclencheurs déjà posés : essai non tenté pour ne pas `
          + 'atteindre la limite de 20. Retirez-en avant de relancer.');
      }
      SocleExecution.programmerReprise('controlerLeSocle', 60 * 1000);
      traces.push('déclencheur');
      affirmer(SocleExecution.repriseProgrammee('controlerLeSocle'), 'déclencheur introuvable');
      const retires = SocleExecution.retirerReprise('controlerLeSocle');
      traces.pop();
      affirmer(retires === 1, `${retires} déclencheur(s) retiré(s) au lieu d’un`);
      return 'créé, vu, retiré';
    });

    controler('SocleSecrets', 'les trois magasins de propriétés', () => {
      const etat = [];
      [['partagee', 'getScriptProperties'], ['document', 'getDocumentProperties'],
        ['personne', 'getUserProperties']].forEach(([portee, methode]) => {
        const nom = `${SOCLE_CONTROLE_PREFIXE_}_${portee}`;
        try {
          SocleSecrets.declarer({ nom, portee, description: 'contrôle temporaire' });
          SocleSecrets.ecrire(nom, 'valeur-de-controle-a-jeter');
          traces.push(nom);
          const relu = SocleSecrets.lire(nom);
          if (relu !== 'valeur-de-controle-a-jeter') throw new Error('relecture différente');
          etat.push(`${portee} : accessible`);
        } catch (e) {
          // Message entier, et non tronqué : c'est la fin qui dit quoi faire,
          // et la couper revient à publier un constat au lieu d'un remède.
          etat.push(`${portee} : ${String(e.message)}`);
        }
      });
      affirmer(etat.some((e) => e.indexOf('partagee : accessible') === 0),
        'le magasin partagé devrait toujours être accessible');
      // Une ligne par magasin : trois messages sur une seule ligne ne se lisent pas.
      return `\n                 ${etat.join('\n                 ')}`;
    });

    controler('SocleSecrets', 'masquage', () => {
      affirmer(SocleSecrets.masquer('ya29.jeton-tres-long-et-secret') === '••••cret', 'masque faux');
      affirmer(SocleSecrets.masquer('court') === '••••', 'un secret court doit tout masquer');
      return 'quatre caractères au plus';
    });

    controler('SocleCourriel', 'quota lu, aucun envoi', () => {
      const reste = MailApp.getRemainingDailyQuota();
      affirmer(typeof reste === 'number', 'quota illisible');
      let refuse = false;
      try {
        SocleCourriel.erreur({ a: 'personne@exemple.invalid', quoi: 'essai' });
      } catch (e) { refuse = true; }
      affirmer(refuse, 'une erreur sans remède aurait dû être refusée avant tout envoi');
      return `${reste} envois restants aujourd’hui, aucun consommé`;
    });

    if (classeur) {
      controler('SocleFeuilles', 'onglet temporaire, écriture et lecture', () => {
        const nom = `${SOCLE_CONTROLE_PREFIXE_}Onglet`;
        SocleFeuilles.ecrireTable(nom, ['Nom', 'Date'], [{ Nom: 'Essai', Date: '2026-09-12' }]);
        traces.push(`onglet:${nom}`);
        const table = SocleFeuilles.lireTable(nom);
        affirmer(table.lignes.length === 1, 'ligne non relue');
        affirmer(table.lignes[0].Nom === 'Essai', 'valeur différente');
        // Le point que le banc simule : Sheets rend un objet Date.
        const brut = table.lignes[0].Date;
        const estDate = Object.prototype.toString.call(brut) === '[object Date]';
        return estDate
          ? 'confirmé : une chaîne de date ressort en objet Date, comme le banc le simule'
          : `attention : la cellule a rendu ${typeof brut}, le banc suppose un objet Date`;
      });
    } else {
      nonTestable('SocleFeuilles', 'lecture et écriture d’onglets',
        'projet autonome : SpreadsheetApp.getActive() ne rend rien. '
        + 'Recopiez le socle dans un projet lié à un classeur d’essai pour tester ce module.');
    }

    nonTestable('SocleApi', 'pagination',
      'logique pure, sans appel à Google : déjà couverte par node banc/test.js');
  } finally {
    // Tout ce qui a été créé est retiré, même si le contrôle a échoué en route.
    traces.forEach((trace) => {
      try {
        if (trace === 'déclencheur') SocleExecution.retirerReprise('controlerLeSocle');
        else if (trace.indexOf('onglet:') === 0 && classeur) {
          const feuille = classeur.getSheetByName(trace.slice(7));
          if (feuille) classeur.deleteSheet(feuille);
        } else SocleSecrets.oublier(trace);
      } catch (e) { lignes.push(`  ménage    ${trace} non retiré : ${e.message}`); }
    });
  }

  lignes.push('');
  lignes.push(`${reussites} contrôle(s) réussi(s), ${echecs} échec(s), ${ignores} non testé(s).`);
  if (echecs === 0 && ignores > 0) {
    lignes.push('Rappel : « non testable ici » ne veut pas dire « réussi ».');
  }

  const rapport = lignes.join('\n');
  Logger.log(rapport);
  return { reussites, echecs, ignores, rapport };
}
