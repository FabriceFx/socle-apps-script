#!/usr/bin/env node
// Vérifie un projet Apps Script avant qu'il parte chez Google — se lance hors
// de Google :
//
//     node outils/verifier.js [projet]          # tout, banc compris
//     node outils/verifier.js [projet] --rapide # syntaxe et portée globale seules
//     node outils/verifier.js [projet] --accepter  # fige les signalements de types actuels
//     node outils/verifier.js [projet] --json
//
// Introduit en v0.13. Il rassemble des contrôles qui existaient — dans un
// CLAUDE.md, dans la mémoire de celui qui pousse — et les fait tourner sans
// qu'on ait à s'en souvenir : le hook Claude Code, le hook Git et la CI
// appellent tous ce même fichier.
//
// Ce qu'il cherche, ce sont **les défauts qui ne se voient qu'en production** :
// un projet qui ne se charge plus, une fonction de menu introuvable, un service
// avancé employé sans être activé, une énumération inventée. Sa première
// mesure, sur dix-neuf projets, en a trouvé trois de cette espèce que ni
// `node --check` ni les bancs n'avaient vus.
//
// Il sort en code 1 sur tout échec. Un avertissement ne bloque pas ; un
// contrôle qu'il n'a pas pu mener est dit « non mesuré », jamais « passé ».

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const P = require('./projets');

const VERSION_SOCLE = fs.readFileSync(path.join(P.RACINE_SOCLE, 'VERSION'), 'utf8').trim();

const args = process.argv.slice(2);
const options = {
  rapide: args.includes('--rapide'),
  accepter: args.includes('--accepter'),
  json: args.includes('--json'),
  sansBanc: args.includes('--sans-banc'),
};
const depart = args.find((a) => !a.startsWith('--')) || process.cwd();
const projet = P.racineProjet(depart);
if (!projet) {
  console.error(`Aucun projet Apps Script dans ${path.resolve(depart)} ni au-dessus : `
    + 'il faut un appsscript.json, à la racine ou dans apps-script/.');
  process.exit(2);
}

const resultats = [];
const noter = (controle, statut, resume, details = [], remede = '') => {
  resultats.push({ controle, statut, resume, details, remede });
};

// --- Configuration propre au projet -----------------------------------------
//
// `verifier.json`, à la racine du projet, versionné. Deux clés :
//   - `typesAcceptes` : les signalements de types déjà examinés et jugés faux
//     positifs. Écrit par `--accepter`, jamais à la main ;
//   - `exceptions` : un motif autorisé **avec sa raison**. Une exception sans
//     raison écrite ne se distingue pas d'un oubli.
const CHEMIN_CONFIG = path.join(projet, 'verifier.json');
const config = fs.existsSync(CHEMIN_CONFIG)
  ? JSON.parse(fs.readFileSync(CHEMIN_CONFIG, 'utf8'))
  : {};
const exceptions = config.exceptions || {};
const profil = (() => {
  try { return P.lireProfil(); } catch (e) { return {}; }
})();

// --- Les fichiers, dans l'ordre de clasp ------------------------------------

const { source, fichiers } = P.fichiersPousses(projet);
const manifeste = JSON.parse(fs.readFileSync(path.join(source, 'appsscript.json'), 'utf8'));

const carte = [];
let premiereLigne = 1;
fichiers.forEach((fichier) => {
  let texte = fs.readFileSync(path.join(source, fichier), 'utf8').replace(/\r\n/g, '\n');
  if (!texte.endsWith('\n')) texte += '\n';
  const lignes = texte.split('\n').length - 1;
  carte.push({ fichier, debut: premiereLigne, lignes, texte });
  premiereLigne += lignes;
});
const concatenation = carte.map((c) => c.texte).join('');
const situer = (ligne) => {
  const morceau = [...carte].reverse().find((c) => c.debut <= ligne) || carte[0];
  return { fichier: morceau.fichier, ligne: ligne - morceau.debut + 1, morceau };
};

// Efface les commentaires — et, sur demande, le contenu des chaînes — en
// gardant chaque saut de ligne : les numéros de ligne restent justes.
//
// Deux usages qui s'opposent, d'où l'option. Les motifs interdits gardent les
// chaînes : `?key=${cle}` vit dans une chaîne de gabarit et s'exécutera. Le
// contrôle des services avancés les efface : un message d'erreur qui cite
// « Drive.Files.list » n'appelle pas Drive.
//
// Un petit automate plutôt que des expressions régulières : `'//'` dans une
// chaîne, `/\/\//` dans une regex ou `http://` ne sont pas des commentaires.
const masquer = (texte, { chaines = false } = {}) => {
  let sortie = '';
  let i = 0;
  let dernierSignifiant = '';
  const blanc = (c) => (c === '\n' ? '\n' : ' ');
  while (i < texte.length) {
    const c = texte[i];
    const s = texte[i + 1];
    if (c === '/' && s === '/') {
      while (i < texte.length && texte[i] !== '\n') { sortie += ' '; i += 1; }
    } else if (c === '/' && s === '*') {
      const fin = texte.indexOf('*/', i + 2);
      const bout = fin === -1 ? texte.length : fin + 2;
      for (; i < bout; i += 1) sortie += blanc(texte[i]);
    } else if (c === '\'' || c === '"' || c === '`') {
      sortie += c;
      i += 1;
      while (i < texte.length && texte[i] !== c) {
        if (texte[i] === '\\') { sortie += chaines ? '  ' : texte.slice(i, i + 2); i += 2; continue; }
        if (c !== '`' && texte[i] === '\n') break;
        sortie += chaines ? blanc(texte[i]) : texte[i];
        i += 1;
      }
      if (i < texte.length) { sortie += texte[i]; i += 1; }
      dernierSignifiant = c;
    } else if (c === '/' && (dernierSignifiant === '' || '(,=:[!&|?{};+-*%<>~^'.includes(dernierSignifiant))) {
      // Une regex littérale : recopiée telle quelle, pour qu'un « // » ou une
      // apostrophe qu'elle contient ne déroute pas la suite.
      let dansClasse = false;
      sortie += c;
      i += 1;
      while (i < texte.length && texte[i] !== '\n') {
        const k = texte[i];
        sortie += k;
        i += 1;
        if (k === '\\') { sortie += texte[i] || ''; i += 1; } else if (k === '[') dansClasse = true;
        else if (k === ']') dansClasse = false;
        else if (k === '/' && !dansClasse) break;
      }
      dernierSignifiant = '/';
    } else {
      sortie += c;
      if (!/\s/.test(c)) dernierSignifiant = c;
      i += 1;
    }
  }
  return sortie;
};
const sansCommentaires = (texte) => masquer(texte);

const ligneEstCommentaire = (texte, ligne) => {
  const brute = (texte.split('\n')[ligne - 1] || '').trim();
  return brute.startsWith('*') || brute.startsWith('/*') || brute.startsWith('//');
};

if (fichiers.length === 0) {
  noter('fichiers', 'echec', 'aucun .gs à pousser', [],
    'Vérifier .claspignore : il exclut peut-être tout.');
} else {
  noter('fichiers', 'ok', `${fichiers.length} .gs, ordre de clasp`, fichiers.map((f, i) => `${i + 1}. ${f}`));
}

// --- Syntaxe ---------------------------------------------------------------
//
// Fichier par fichier d'abord, pour dire où ; puis l'ensemble, parce qu'Apps
// Script partage **une** portée globale : deux `const` de même nom dans deux
// fichiers sont une erreur de syntaxe du projet entier, que chaque fichier
// pris seul ne montre pas.

const ligneDeLErreur = (erreur) => Number((/:(\d+)\n/.exec(erreur.stack || '') || [])[1] || 0);
const erreursSyntaxe = [];
carte.forEach(({ fichier, texte }) => {
  try {
    new vm.Script(texte, { filename: fichier });
  } catch (erreur) {
    erreursSyntaxe.push(`${fichier}:${ligneDeLErreur(erreur)} — ${erreur.message}`);
  }
});
if (erreursSyntaxe.length === 0 && carte.length > 0) {
  try {
    new vm.Script(concatenation, { filename: 'projet' });
  } catch (erreur) {
    const { fichier, ligne } = situer(ligneDeLErreur(erreur));
    erreursSyntaxe.push(`${fichier}:${ligne} — ${erreur.message} (entre fichiers)`);
  }
}
if (erreursSyntaxe.length) {
  noter('syntaxe', 'echec', `${erreursSyntaxe.length} erreur(s) — le projet ne se chargera pas`,
    erreursSyntaxe,
    'Une seule erreur de syntaxe rend TOUTES les fonctions du projet introuvables.');
} else if (carte.length) {
  noter('syntaxe', 'ok', 'le projet se charge');
}

// --- TypeScript, s'il est installé -------------------------------------------

let ts = null;
try {
  ts = require(require.resolve('typescript', { paths: [P.RACINE_SOCLE] }));
} catch (e) {
  ts = null;
}
const RACINE_TYPES = path.join(P.RACINE_SOCLE, 'node_modules', '@types');
const typesPresents = ts && fs.existsSync(path.join(RACINE_TYPES, 'google-apps-script'));

// --- Portée globale ----------------------------------------------------------

const declarations = [];
const declarer = (nom, genre, fichier, ligne) => declarations.push({ nom, genre, fichier, ligne });

if (ts) {
  // L'arbre syntaxique, pas une expression régulière : une ligne qui commence
  // par « function » dans une chaîne de gabarit n'est pas une déclaration.
  carte.forEach(({ fichier, texte }) => {
    const arbre = ts.createSourceFile(fichier, texte, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
    const ligneDe = (noeud) => arbre.getLineAndCharacterOfPosition(noeud.getStart()).line + 1;
    const noms = (liaison, genre, ligne) => {
      if (ts.isIdentifier(liaison)) declarer(liaison.text, genre, fichier, ligne);
      else liaison.elements.forEach((el) => { if (!ts.isOmittedExpression(el)) noms(el.name, genre, ligne); });
    };
    arbre.statements.forEach((instr) => {
      if (ts.isFunctionDeclaration(instr) && instr.name) {
        declarer(instr.name.text, 'function', fichier, ligneDe(instr));
      } else if (ts.isClassDeclaration(instr) && instr.name) {
        declarer(instr.name.text, 'class', fichier, ligneDe(instr));
      } else if (ts.isVariableStatement(instr)) {
        const drapeaux = instr.declarationList.flags;
        // eslint-disable-next-line no-bitwise
        const genre = drapeaux & ts.NodeFlags.Const ? 'const' : (drapeaux & ts.NodeFlags.Let ? 'let' : 'var');
        instr.declarationList.declarations.forEach((d) => noms(d.name, genre, ligneDe(instr)));
      }
    });
  });
} else {
  // Repli sans TypeScript : le style des projets met toute déclaration de
  // premier niveau en colonne 0. Approximatif, et dit comme tel.
  carte.forEach(({ fichier, texte }) => {
    sansCommentaires(texte).split('\n').forEach((ligne, i) => {
      const m = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^(const|let|var|class)\s+([A-Za-z_$][\w$]*)/.exec(ligne);
      if (m) declarer(m[1] || m[3], m[1] ? 'function' : m[2], fichier, i + 1);
    });
  });
}

const parNom = new Map();
declarations.forEach((d) => parNom.set(d.nom, [...(parNom.get(d.nom) || []), d]));
const doublons = [...parNom.entries()].filter(([, ds]) => ds.length > 1);
const fonctionsDeclarees = new Set(declarations.filter((d) => d.genre === 'function').map((d) => d.nom));
const tousLesNoms = new Set(declarations.map((d) => d.nom));

if (carte.length) {
  if (doublons.length) {
    noter('portée globale', 'echec', `${doublons.length} nom(s) déclaré(s) plusieurs fois`,
      doublons.map(([nom, ds]) => `${nom} : ${ds.map((d) => `${d.genre} ${d.fichier}:${d.ligne}`).join(', ')}`),
      'Deux « function » de même nom ne lèvent rien : la dernière poussée gagne, en silence. '
      + 'Deux « const » empêchent le projet entier de se charger. Renommer l’une des deux.');
  } else {
    noter('portée globale', 'ok', `${declarations.length} déclarations, aucun doublon${ts ? '' : ' (repli approximatif, sans TypeScript)'}`);
  }

  // Les liaisons `let` de premier niveau traversent mal les fichiers : l'état
  // partagé passe par un objet `const` muté en place.
  const lets = declarations.filter((d) => d.genre === 'let');
  if (lets.length && !exceptions.let) {
    noter('let global', 'avertissement', `${lets.length} « let » de portée globale`,
      lets.map((d) => `${d.nom} — ${d.fichier}:${d.ligne}`),
      'Passer par un objet const muté en place ; ou justifier dans verifier.json → exceptions.let.');
  }
}

// --- Cibles résolues par leur nom --------------------------------------------
//
// Un déclencheur, une entrée de menu, un `google.script.run` désignent leur
// fonction **par une chaîne**. Apps Script la cherche sur l'objet global, où
// seules les `function` déclarées figurent : une `const nom = () => …` n'y est
// pas. Et `google.script.run` refuse en plus toute fonction finissant par `_`.
// Dans les deux cas, l'erreur n'arrive qu'au clic : « Fonction de script
// introuvable ».

if (carte.length) {
  const ciblesServeur = [];
  const motifsCibles = [
    [/newTrigger\(\s*['"]([\w$]+)['"]/g, 'déclencheur'],
    [/\.addItem\(\s*[^,()]+,\s*['"]([\w$]+)['"]/g, 'entrée de menu'],
    [/programmerReprise\(\s*['"]([\w$]+)['"]/g, 'reprise programmée'],
  ];
  carte.forEach(({ fichier, texte }) => {
    const code = sansCommentaires(texte);
    motifsCibles.forEach(([motif, quoi]) => {
      for (const m of code.matchAll(motif)) {
        ciblesServeur.push({ nom: m[1], quoi, ou: `${fichier}:${code.slice(0, m.index).split('\n').length}` });
      }
    });
  });
  const ciblesClient = [];
  const parcourirHtml = (dossier) => fs.readdirSync(dossier, { withFileTypes: true }).forEach((e) => {
    const complet = path.join(dossier, e.name);
    if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') parcourirHtml(complet);
    else if (e.name.endsWith('.html')) {
      const texte = fs.readFileSync(complet, 'utf8');
      const motif = /google\.script\.run(?:\s*\.\s*with\w+\((?:[^()]|\([^()]*\))*\))*\s*\.\s*([\w$]+)\s*\(/g;
      for (const m of texte.matchAll(motif)) {
        if (/^with/.test(m[1])) continue;
        ciblesClient.push({ nom: m[1], quoi: 'google.script.run', ou: `${path.relative(source, complet)}:${texte.slice(0, m.index).split('\n').length}` });
      }
    }
  });
  parcourirHtml(source);

  const fautives = [
    ...ciblesServeur.filter((c) => !fonctionsDeclarees.has(c.nom)).map((c) => ({
      ...c, pourquoi: tousLesNoms.has(c.nom) ? 'déclarée en const, invisible pour Apps Script' : 'n’existe pas',
    })),
    ...ciblesClient.filter((c) => !fonctionsDeclarees.has(c.nom) || c.nom.endsWith('_')).map((c) => ({
      ...c,
      pourquoi: c.nom.endsWith('_') ? 'finit par « _ » : google.script.run ne voit pas les fonctions privées'
        : (tousLesNoms.has(c.nom) ? 'déclarée en const, invisible pour Apps Script' : 'n’existe pas'),
    })),
  ];
  const total = ciblesServeur.length + ciblesClient.length;
  if (fautives.length) {
    noter('cibles par nom', 'echec', `${fautives.length} cible(s) introuvable(s) à l’exécution`,
      fautives.map((c) => `${c.nom} (${c.quoi}, ${c.ou}) — ${c.pourquoi}`),
      'Une cible de menu, de déclencheur ou de google.script.run doit être une « function » déclarée, sans « _ » final pour le client.');
  } else if (total) {
    noter('cibles par nom', 'ok', `${total} cible(s) de menu, déclencheur ou client, toutes déclarées`);
  }
}

// --- Services avancés --------------------------------------------------------
//
// Les définitions de types déclarent tous les services avancés, activés ou
// non : le contrôle de types ne voit donc pas un `Drive.Files.list` dans un
// projet où Drive n'est pas activé. Apps Script, lui, lève à l'exécution.

const actives = new Map();
((manifeste.dependencies || {}).enabledAdvancedServices || [])
  .forEach((s) => actives.set(s.userSymbol, s.serviceId));
const bibliotheques = ((manifeste.dependencies || {}).libraries || []).map((b) => b.userSymbol);

const declaresParLesTypes = new Set();
if (typesPresents) {
  const lister = (dossier) => fs.readdirSync(dossier, { withFileTypes: true }).forEach((e) => {
    const complet = path.join(dossier, e.name);
    if (e.isDirectory()) lister(complet);
    else if (e.name.endsWith('.d.ts')) {
      for (const m of fs.readFileSync(complet, 'utf8').matchAll(/declare (?:var|const) (\w+)/g)) declaresParLesTypes.add(m[1]);
    }
  });
  lister(path.join(RACINE_TYPES, 'google-apps-script'));
}
const SERVICES_AVANCES = ['AdminDirectory', 'AdminGroupsMigration', 'AdminGroupsSettings', 'AdminLicenseManager',
  'AdminReports', 'AdminReseller', 'Analytics', 'AnalyticsAdmin', 'AnalyticsData', 'BigQuery', 'Calendar',
  'Chat', 'Classroom', 'Docs', 'Drive', 'DriveActivity', 'DriveLabels', 'Gmail', 'GroupsSettings', 'People',
  'Sheets', 'Slides', 'Tasks', 'YouTube', 'YouTubeAnalytics', 'Vault', 'WorkspaceEvents', 'CloudIdentityGroups'];

if (carte.length) {
  const employes = new Map();
  carte.forEach(({ fichier, texte }) => {
    const code = masquer(texte, { chaines: true });
    SERVICES_AVANCES.forEach((symbole) => {
      if (actives.has(symbole) || tousLesNoms.has(symbole)) return;
      if (new RegExp(`(?:const|let|var|function)\\s+${symbole}\\b|\\b${symbole}\\s*(?:,|\\)\\s*=>)`).test(code)) return;
      const m = new RegExp(`(?<![\\w$.'"])${symbole}\\.[A-Z]\\w*\\.`).exec(code);
      if (m && !employes.has(symbole)) employes.set(symbole, `${fichier}:${code.slice(0, m.index).split('\n').length}`);
    });
  });
  if (employes.size) {
    noter('services avancés', 'echec', `${employes.size} service(s) employé(s) sans être activé(s)`,
      [...employes.entries()].map(([s, ou]) => `${s} (${ou}) — absent de dependencies.enabledAdvancedServices`),
      'Activer le service dans appsscript.json (ou l’éditeur > Services), sinon ReferenceError à l’exécution.');
  } else if (actives.size) {
    noter('services avancés', 'ok', `activés : ${[...actives.keys()].join(', ')}`);
  }
}

// --- Types -------------------------------------------------------------------
//
// Le contrôle de types sert de documentation exécutable : une énumération
// inventée (`XFrameOptionsMode.DENY`), un `setValues` qui reçoit une chaîne,
// un argument du mauvais type sont signalés avant que Google ne les refuse.
//
// Le JavaScript non annoté produit aussi des faux positifs. D'où un cliquet :
// les signalements présents au moment de `--accepter` sont figés dans
// verifier.json ; seul un signalement **nouveau** fait échouer. Trois familles
// échappent au cliquet parce qu'elles ne sont jamais fausses — elles ne
// s'acceptent qu'avec une raison écrite dans `exceptions`.

const GRAVES = new Map([
  [2448, 'employée avant sa déclaration'],
  [2449, 'employée avant sa déclaration'],
  [2450, 'employée avant sa déclaration'],
  [2304, 'nom inconnu'],
  [2552, 'nom inconnu'],
]);
const DEJA_COUVERTS = new Set([2300, 2393, 2451]);   // doublons : la portée globale les dit mieux

// Le JavaScript non annoté fait inférer à TypeScript des types qu'aucun
// humain n'a écrits : `({ quoi, cause }) => …` rend `cause` obligatoire, et un
// objet enrichi après coup « n'a pas » ses nouveaux champs. Ces signalements
// portent sur un type `{ …: any … }` que personne n'a déclaré ; ils ne disent
// rien du code, et reviendraient à chaque nouvel appel. Ils sont écartés —
// et comptés, pour que l'écart reste visible.
const BRUIT_D_INFERENCE = new Set([2322, 2345, 2353, 2559, 2739, 2740, 2741]);
const TYPE_INFERE = /type '\{[^']*: any\b[^']*\}'/;
const estBruit = (code, message) => (code >= 1000 && code < 2000)   // JSDoc mal lu : la vraie syntaxe, V8 la contrôle
  || (BRUIT_D_INFERENCE.has(code) && TYPE_INFERE.test(message));

// Les définitions de types ont du retard sur Google. Chaque correctif cite la
// page qui le fonde : un correctif sans source serait une croyance de plus.
const CORRECTIFS_TYPES = [
  // https://developers.google.com/apps-script/reference/drive/permission — vérifié le 2026-10-10
  'declare namespace GoogleAppsScript.Drive { enum Permission { FILE_ORGANIZER = 100 } }',
  // https://developers.google.com/workspace/admin/directory/reference/rest/v1/users/signOut — vérifié le 2026-10-15
  // Exige la portée admin.directory.user.security, et elle seule.
  'declare namespace GoogleAppsScript.AdminDirectory.Collection { interface UsersCollection { signOut(userKey: string): void; } }',
];

// Les noms courts que les JSDoc des projets emploient. Sans ces alias, chaque
// `@return {HtmlOutput}` serait signalé « nom inconnu ».
const ALIAS_JSDOC = {
  HtmlOutput: 'GoogleAppsScript.HTML.HtmlOutput',
  HtmlTemplate: 'GoogleAppsScript.HTML.HtmlTemplate',
  Blob: 'GoogleAppsScript.Base.Blob',
  BlobSource: 'GoogleAppsScript.Base.BlobSource',
  HTTPResponse: 'GoogleAppsScript.URL_Fetch.HTTPResponse',
  Spreadsheet: 'GoogleAppsScript.Spreadsheet.Spreadsheet',
  Sheet: 'GoogleAppsScript.Spreadsheet.Sheet',
  Range: 'GoogleAppsScript.Spreadsheet.Range',
  Cache: 'GoogleAppsScript.Cache.Cache',
  Lock: 'GoogleAppsScript.Lock.Lock',
  Properties: 'GoogleAppsScript.Properties.Properties',
  Folder: 'GoogleAppsScript.Drive.Folder',
  GmailThread: 'GoogleAppsScript.Gmail.GmailThread',
  GmailMessage: 'GoogleAppsScript.Gmail.GmailMessage',
  GmailAttachment: 'GoogleAppsScript.Gmail.GmailAttachment',
  Trigger: 'GoogleAppsScript.Script.Trigger',
  TextOutput: 'GoogleAppsScript.Content.TextOutput',
  Card: 'GoogleAppsScript.Card_Service.Card',
};

const signature = (d) => `${d.fichier}|TS${d.code}|${d.message}`;

if (options.rapide) {
  noter('types', 'non-mesure', 'mode rapide');
} else if (!typesPresents) {
  noter('types', 'non-mesure', 'TypeScript absent du socle',
    [], `npm ci dans ${P.RACINE_SOCLE}`);
} else if (erreursSyntaxe.length) {
  noter('types', 'non-mesure', 'syntaxe à corriger d’abord');
} else if (carte.length) {
  const dossierTravail = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-'));
  try {
    const fichierProjet = path.join(dossierTravail, 'projet.js');
    const fichierPrelude = path.join(dossierTravail, 'prelude.d.ts');
    fs.writeFileSync(fichierProjet, concatenation);
    const prelude = [
      ...Object.entries(ALIAS_JSDOC).map(([court, long]) => `type ${court} = ${long};`),
      ...CORRECTIFS_TYPES,
    ];
    [...actives.keys(), ...bibliotheques]
      .filter((s) => !declaresParLesTypes.has(s))
      .forEach((s) => prelude.push(`declare var ${s}: any;`));
    fs.writeFileSync(fichierPrelude, `${prelude.join('\n')}\n`);

    const programme = ts.createProgram([fichierProjet, fichierPrelude], {
      allowJs: true,
      checkJs: true,
      noEmit: true,
      // ES2022 : les projets emploient `Error.cause` en production. Ce que le
      // moteur de Google accepte au-delà se mesure avec outils/SondeES.gs.
      target: ts.ScriptTarget.ES2022,
      lib: ['lib.es2022.d.ts'],
      types: ['google-apps-script'],
      typeRoots: [RACINE_TYPES],
      skipLibCheck: true,
      strict: false,
    });
    const diagnostics = ts.getPreEmitDiagnostics(programme)
      .filter((d) => d.file && path.resolve(d.file.fileName) === path.resolve(fichierProjet))
      .filter((d) => !DEJA_COUVERTS.has(d.code));
    const bruit = diagnostics.filter((d) => estBruit(d.code, ts.flattenDiagnosticMessageText(d.messageText, ' ')));
    const retenus = diagnostics
      .filter((d) => !bruit.includes(d))
      .map((d) => {
        const { line } = d.file.getLineAndCharacterOfPosition(d.start);
        const { fichier, ligne, morceau } = situer(line + 1);
        const message = ts.flattenDiagnosticMessageText(d.messageText, ' ');
        const grave = GRAVES.has(d.code)
          && !(d.code === 2304 || d.code === 2552 ? ligneEstCommentaire(morceau.texte, ligne) : false);
        return { fichier, ligne, code: d.code, message, grave: grave || /does not exist on type 'typeof /.test(message) };
      });

    const graves = retenus.filter((d) => d.grave && !exceptions[signature(d)]);
    const ordinaires = retenus.filter((d) => !d.grave);

    if (options.accepter) {
      const fige = {};
      ordinaires.forEach((d) => { fige[signature(d)] = (fige[signature(d)] || 0) + 1; });
      config.typesAcceptes = Object.fromEntries(Object.entries(fige).sort());
      fs.writeFileSync(CHEMIN_CONFIG, `${JSON.stringify(config, null, 2)}\n`);
    }
    const acceptes = new Map(Object.entries(config.typesAcceptes || {}));
    const nouveaux = [];
    ordinaires.forEach((d) => {
      const reste = acceptes.get(signature(d)) || 0;
      if (reste > 0) acceptes.set(signature(d), reste - 1);
      else nouveaux.push(d);
    });
    const perimes = [...acceptes.values()].reduce((a, b) => a + b, 0);

    const lire = (d) => `${d.fichier}:${d.ligne} TS${d.code} — ${d.message}`;
    const ecartes = bruit.length ? ` ; ${bruit.length} d’inférence écarté(s)` : '';
    if (graves.length) {
      const membres = graves.some((d) => !GRAVES.has(d.code));
      noter('types', 'echec', `${graves.length} défaut(s) qui lèvent à l’exécution`,
        [...graves.map((d) => `${lire(d)}  [${GRAVES.get(d.code) || 'membre inexistant'}]`), ...nouveaux.map(lire)],
        'Corriger le code : un nom inconnu ou lu avant sa déclaration lève à coup sûr. '
        + (membres ? 'Pour un membre d’énumération, vérifier d’abord la page de Google — les types ont parfois du retard : '
          + 'alors, correctif sourcé dans CORRECTIFS_TYPES du socle. ' : '')
        + 'Un usage voulu se justifie dans verifier.json → exceptions["<fichier>|TS<code>|<message>"] = "raison".');
    } else if (nouveaux.length) {
      noter('types', 'echec', `${nouveaux.length} signalement(s) nouveau(x)${ecartes}`, nouveaux.map(lire),
        'Corriger, ou — si c’est un faux positif examiné — relancer avec --accepter pour le figer.');
    } else {
      const deja = ordinaires.length;
      noter('types', 'ok', `${deja ? `${deja} signalement(s), tous déjà examinés` : 'aucun signalement'}${ecartes}`,
        perimes ? [`${perimes} signalement(s) accepté(s) ne se produisent plus : --accepter pour nettoyer`] : []);
    }
  } finally {
    fs.rmSync(dossierTravail, { recursive: true, force: true });
  }
}

// --- Version et journal ------------------------------------------------------

const version = P.lireVersion(projet);
if (carte.length) {
  // Dans le socle lui-même, les constantes SOCLE_… sont la version du projet ;
  // ailleurs, elles disent seulement d'où vient une copie.
  const estLeSocle = path.resolve(projet) === path.resolve(P.RACINE_SOCLE);
  const constantes = P.constantesDeVersion(source, fichiers).filter((c) => estLeSocle || !c.module);
  if (!version) {
    noter('version', 'avertissement', 'pas de fichier VERSION', [],
      'Un déploiement sert une copie figée : sans numéro, impossible de savoir laquelle tourne.');
  } else if (constantes.some((c) => c.valeur === version)) {
    const c = constantes.find((k) => k.valeur === version);
    noter('version', 'ok', `${version} (${c.nom})`);
  } else if (constantes.length) {
    noter('version', 'echec', `VERSION dit ${version}, le code dit autre chose`,
      constantes.map((c) => `${c.nom} = '${c.valeur}' — ${c.fichier}:${c.ligne}`),
      'Une version affichée et fausse est pire que pas de version. Aligner la constante sur VERSION.');
  } else {
    noter('version', 'avertissement', `${version}, mais aucune constante ne la porte`, [],
      'Déclarer une constante …VERSION… = VERSION, et l’afficher dans « À propos ».');
  }

  const journal = path.join(projet, 'CHANGELOG.md');
  if (version && fs.existsSync(journal)) {
    const texte = fs.readFileSync(journal, 'utf8');
    if (new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(texte)) {
      noter('journal', 'ok', `entrée [${version}] présente`);
    } else {
      noter('journal', 'avertissement', `pas d’entrée [${version}] dans CHANGELOG.md`, [],
        'L’écrire avant de publier : publier.js refusera sans elle.');
    }
  }
}

// --- Manifeste ---------------------------------------------------------------

if (carte.length) {
  const remarques = [];
  let statut = 'ok';
  if (manifeste.runtimeVersion !== 'V8') {
    statut = 'echec';
    remarques.push(`runtimeVersion vaut ${manifeste.runtimeVersion || 'rien (Rhino)'} : ES6+ indisponible`);
  }
  if (profil.fuseau && manifeste.timeZone && manifeste.timeZone !== profil.fuseau && !exceptions.fuseau) {
    if (statut === 'ok') statut = 'avertissement';
    remarques.push(`timeZone ${manifeste.timeZone}, le profil dit ${profil.fuseau} : `
      + 'toute date écrite après le décalage se range la veille (clasp create pose le fuseau du compte)');
  }
  const LARGES = {
    'https://mail.google.com/': 'toute la messagerie, suppression définitive comprise',
    'https://www.googleapis.com/auth/drive': 'tout le Drive, en écriture',
  };
  (manifeste.oauthScopes || []).forEach((portee) => {
    if (LARGES[portee] && !exceptions[portee]) {
      if (statut === 'ok') statut = 'avertissement';
      remarques.push(`portée ${portee} : ${LARGES[portee]} — justifier dans verifier.json → exceptions`);
    }
  });
  const resume = `${manifeste.runtimeVersion || '?'}, ${manifeste.timeZone || 'fuseau ?'}, `
    + (manifeste.oauthScopes ? `${manifeste.oauthScopes.length} portée(s) déclarée(s)` : 'portées déduites par Google');
  noter('manifeste', statut, resume, remarques);
}

// --- Motifs interdits ----------------------------------------------------------
//
// Ceux de ~/.claude/CLAUDE.md qui se contrôlent d'un grep. Chacun a coûté.

const MOTIFS = [
  {
    re: /String\((?:[^()]|\([^()]*\))*\)\.slice\(\s*0\s*,\s*10\s*\)/g,
    statut: 'echec',
    quoi: 'String(valeur).slice(0, 10) : sur une Date, rend « Thu May 14 » et fausse tout tri',
  },
  {
    re: /[?&]key=(?:\$\{|['"]\s*\+)/g,
    statut: 'echec',
    quoi: 'clé d’API dans l’URL : elle finit dans les journaux — en-tête x-goog-api-key',
  },
  {
    re: /XFrameOptionsMode\.(?!ALLOWALL\b|DEFAULT\b)\w+/g,
    statut: 'echec',
    quoi: 'XFrameOptionsMode ne connaît que ALLOWALL et DEFAULT : le reste vaut undefined',
  },
  {
    re: /\bGmailApp\b/g,
    statut: 'avertissement',
    cle: 'GmailApp',
    quoi: 'GmailApp demande la lecture de la messagerie ; MailApp suffit pour envoyer',
  },
];
if (carte.length) {
  const trouves = [];
  let pire = 'ok';
  MOTIFS.forEach(({ re, statut, quoi, cle }) => {
    if (cle && exceptions[cle]) return;
    const lieux = [];
    carte.forEach(({ fichier, texte }) => {
      const code = sansCommentaires(texte);
      for (const m of code.matchAll(re)) lieux.push(`${fichier}:${code.slice(0, m.index).split('\n').length}`);
    });
    if (!lieux.length) return;
    trouves.push(`${quoi} — ${lieux.slice(0, 5).join(', ')}${lieux.length > 5 ? ` (+${lieux.length - 5})` : ''}`);
    if (statut === 'echec') pire = 'echec';
    else if (pire === 'ok') pire = 'avertissement';
  });
  noter('motifs', pire, trouves.length ? `${trouves.length} motif(s) relevé(s)` : 'aucun', trouves,
    pire === 'ok' ? '' : 'Un motif justifié s’autorise dans verifier.json → exceptions, avec sa raison.');
}

// --- Secrets -----------------------------------------------------------------

const SECRETS = [
  [/AIza[0-9A-Za-z_-]{35}/g, 'clé d’API Google'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'clé privée'],
  [/ya29\.[0-9A-Za-z_-]{60,}/g, 'jeton OAuth Google'],
  [/sk-ant-[0-9A-Za-z_-]{20,}/g, 'clé Anthropic'],
  [/\bghp_[0-9A-Za-z]{36}\b/g, 'jeton GitHub'],
];
if (carte.length) {
  const fuites = [];
  [...carte, { fichier: 'appsscript.json', texte: JSON.stringify(manifeste) }].forEach(({ fichier, texte }) => {
    SECRETS.forEach(([re, quoi]) => {
      for (const m of texte.matchAll(re)) fuites.push(`${quoi} — ${fichier}:${texte.slice(0, m.index).split('\n').length}`);
    });
  });
  noter('secrets', fuites.length ? 'echec' : 'ok', fuites.length ? `${fuites.length} secret(s) en clair` : 'aucun en clair',
    fuites, fuites.length ? 'Le ranger dans PropertiesService (SocleSecrets), et le révoquer : il a déjà circulé.' : '');
}

// --- Banc ----------------------------------------------------------------------

if (options.rapide || options.sansBanc) {
  noter('banc', 'non-mesure', options.rapide ? 'mode rapide' : '--sans-banc');
} else {
  const candidats = [['banc/test.js'], ['tests/run.js']];
  const trouve = candidats.find(([f]) => fs.existsSync(path.join(projet, f)));
  if (!trouve) {
    noter('banc', 'avertissement', 'aucun banc d’essai', [],
      'Un projet Apps Script se teste sans déploiement : banc/test.js, avec les services simulés.');
  } else {
    const debut = Date.now();
    const execution = spawnSync(process.execPath, trouve, {
      cwd: projet, encoding: 'utf8', timeout: 180000, env: { ...process.env, FORCE_COLOR: '0' },
    });
    const duree = ((Date.now() - debut) / 1000).toFixed(1).replace('.', ',');
    const sortie = `${execution.stdout || ''}${execution.stderr || ''}`.trim().split('\n');
    if (execution.status === 0) {
      noter('banc', 'ok', `${trouve[0]} — ${duree} s`, [sortie[sortie.length - 1]]);
    } else {
      noter('banc', 'echec', `${trouve[0]} échoue${execution.error ? ` (${execution.error.code})` : ''}`,
        sortie.slice(-15), `Relancer : (cd ${projet} && node ${trouve[0]})`);
    }
  }
}

// --- Compte rendu --------------------------------------------------------------

const echecs = resultats.filter((r) => r.statut === 'echec');
const avertissements = resultats.filter((r) => r.statut === 'avertissement');
const nonMesures = resultats.filter((r) => r.statut === 'non-mesure');

if (options.json) {
  console.log(JSON.stringify({
    projet, version, socle: VERSION_SOCLE, resultats,
    echecs: echecs.length, avertissements: avertissements.length,
    empreinte: crypto.createHash('sha256').update(concatenation).digest('hex').slice(0, 12),
  }, null, 2));
} else {
  const couleur = process.stdout.isTTY;
  const peindre = (code, texte) => (couleur ? `\x1b[${code}m${texte}\x1b[0m` : texte);
  const SIGNES = {
    ok: peindre('32', '✓'), echec: peindre('31', '✗'), avertissement: peindre('33', '!'), 'non-mesure': peindre('2', '·'),
  };
  console.log(`verifier (socle v${VERSION_SOCLE}) — ${path.basename(projet)}${version ? ` v${version}` : ''}`);
  resultats.forEach((r) => {
    console.log(`  ${SIGNES[r.statut]} ${r.controle.padEnd(17)} ${r.resume}`);
    const montrer = r.statut === 'ok' ? r.details.filter(() => r.controle !== 'fichiers') : r.details;
    montrer.slice(0, 20).forEach((d) => console.log(`      ${d}`));
    if (montrer.length > 20) console.log(`      … et ${montrer.length - 20} autre(s)`);
    if (r.remede && r.statut !== 'ok') console.log(`      → ${r.remede}`);
  });
  const bilan = [
    echecs.length ? `${echecs.length} échec(s)` : null,
    avertissements.length ? `${avertissements.length} avertissement(s)` : null,
    nonMesures.length ? `${nonMesures.length} non mesuré(s)` : null,
  ].filter(Boolean).join(', ');
  console.log(echecs.length
    ? peindre('31', `Ne pas pousser : ${bilan}.`)
    : peindre('32', `Prêt à pousser${bilan ? ` (${bilan})` : ''}.`));
}

process.exit(echecs.length ? 1 : 0);
