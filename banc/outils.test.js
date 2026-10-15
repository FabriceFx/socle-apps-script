// Banc des outils — se lance hors de Google :
//
//     node banc/outils.test.js
//
// Introduit en v0.13. Chaque défaut que verifier.js prétend attraper est
// réintroduit ici dans un projet d'essai, et le banc vérifie qu'il l'attrape —
// puis qu'il ne crie pas sur la version saine du même code. Un contrôle qu'on
// n'a jamais vu échouer n'a rien prouvé.
//
// Même exigence pour le cœur du simulateur : il doit refuser ce que Google
// refuse. Un faux complaisant valide du code faux.

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const OUTILS = path.join(RACINE, 'outils');
const TEMPORAIRE = fs.mkdtempSync(path.join(os.tmpdir(), 'socle-outils-'));
const VERSION = fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim();

let reussis = 0;
const echecs = [];
const verifier = (condition, quoi) => {
  if (condition) reussis += 1;
  else echecs.push(quoi);
};
const egal = (obtenu, attendu, quoi) => verifier(JSON.stringify(obtenu) === JSON.stringify(attendu),
  `${quoi} — obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`);
const leve = (fn, motif, quoi) => {
  try {
    fn();
    echecs.push(`${quoi} — n’a pas levé`);
  } catch (e) {
    verifier(motif.test(e.message), `${quoi} — message : ${e.message}`);
  }
};

// --- Projets d'essai --------------------------------------------------------------

let compteur = 0;
const projetEssai = (fichiers, { version = '1.0.0', manifeste = {} } = {}) => {
  compteur += 1;
  const dossier = path.join(TEMPORAIRE, `projet-${compteur}`);
  fs.mkdirSync(path.join(dossier, 'apps-script'), { recursive: true });
  fs.writeFileSync(path.join(dossier, 'VERSION'), `${version}\n`);
  fs.writeFileSync(path.join(dossier, 'CHANGELOG.md'), `# Journal\n\n## [${version}] - 2026-10-10\n`);
  fs.writeFileSync(path.join(dossier, 'apps-script', 'appsscript.json'), JSON.stringify({
    timeZone: 'Europe/Paris', runtimeVersion: 'V8', dependencies: {}, ...manifeste,
  }));
  const tout = { 'Version.gs': `const ESSAI_VERSION_ = '${version}';\n`, ...fichiers };
  Object.entries(tout).forEach(([nom, contenu]) => {
    const chemin = nom.includes('/') || nom === '.claspignore' || nom === '.clasp.json'
      ? path.join(dossier, nom) : path.join(dossier, 'apps-script', nom);
    fs.mkdirSync(path.dirname(chemin), { recursive: true });
    fs.writeFileSync(chemin, contenu);
  });
  return dossier;
};

const verification = (dossier, ...options) => {
  const r = spawnSync(process.execPath, [path.join(OUTILS, 'verifier.js'), dossier, '--json', '--sans-banc', ...options],
    { encoding: 'utf8', env: { ...process.env, ATELIER_PROFIL: path.join(TEMPORAIRE, 'aucun-profil.json') } });
  const rapport = JSON.parse(r.stdout);
  rapport.code = r.status;
  rapport.statut = (controle) => (rapport.resultats.find((x) => x.controle === controle) || {}).statut;
  rapport.detail = (controle) => ((rapport.resultats.find((x) => x.controle === controle) || {}).details || []).join('\n');
  return rapport;
};

const PROPRE = {
  'Menu.gs': "function onOpen() {\n  SpreadsheetApp.getUi().createMenu('Essai').addItem('Lancer', 'lancerEssai').addToUi();\n}\n"
    + 'function lancerEssai() {\n  return calculer_(2);\n}\n',
  'Calcul.gs': 'const calculer_ = (n) => n * 2;\n',
};

try {
  console.log('— A. Un projet sain passe');
  {
    const r = verification(projetEssai(PROPRE));
    egal(r.echecs, 0, 'aucun échec sur un projet sain');
    egal(r.code, 0, 'code de sortie 0');
    egal(r.statut('types'), 'ok', 'types : rien à redire');
  }

  console.log('— B. Portée globale');
  {
    const r = verification(projetEssai({ ...PROPRE, 'Autre.gs': 'function lancerEssai() { return 0; }\n' }));
    egal(r.statut('portée globale'), 'echec', 'deux « function » de même nom : échec, alors que node --check l’accepte');
    verifier(/lancerEssai/.test(r.detail('portée globale')), 'le nom en double est cité');
    egal(r.code, 1, 'code de sortie 1');
  }
  {
    const r = verification(projetEssai({ ...PROPRE, 'Autre.gs': 'const calculer_ = 1;\n' }));
    egal(r.statut('syntaxe'), 'echec', 'deux « const » de même nom : le projet ne se charge pas');
  }
  {
    const r = verification(projetEssai({ ...PROPRE, 'Etat.gs': 'let compteurGlobal = 0;\n' }));
    egal(r.statut('let global'), 'avertissement', 'un « let » de portée globale est signalé');
  }

  console.log('— C. Ordre de chargement de clasp');
  {
    // Aaa.gs est poussé avant Zzz.gs : il lit une constante pas encore déclarée.
    const fichiers = { 'Aaa.gs': 'const STATUTS_ = ORDRE_STATUTS_;\n', 'Zzz.gs': "const ORDRE_STATUTS_ = ['a'];\n" };
    const r = verification(projetEssai(fichiers));
    egal(r.statut('types'), 'echec', 'constante lue avant d’être déclarée, dans l’ordre de clasp');
    verifier(/TS2448/.test(r.detail('types')), 'signalée comme TS2448');
    const sain = verification(projetEssai({ 'Aaa.gs': "const ORDRE_STATUTS_ = ['a'];\n", 'Zzz.gs': 'const STATUTS_ = ORDRE_STATUTS_;\n' }));
    egal(sain.statut('types'), 'ok', 'dans le bon ordre, rien');
  }
  {
    const dossier = projetEssai({
      'Aaa.gs': 'const STATUTS_ = ORDRE_STATUTS_;\n',
      'Zzz.gs': "const ORDRE_STATUTS_ = ['a'];\n",
      '.clasp.json': JSON.stringify({ scriptId: 'x', rootDir: 'apps-script', filePushOrder: ['apps-script/Zzz.gs'] }),
    });
    egal(verification(dossier).statut('types'), 'ok', 'filePushOrder est respecté');
  }

  console.log('— D. Cibles résolues par leur nom');
  {
    const r = verification(projetEssai({
      ...PROPRE,
      'Menu.gs': "function onOpen() {\n  SpreadsheetApp.getUi().createMenu('Essai').addItem('Lancer', 'lancerEssai').addToUi();\n}\n"
        + 'const lancerEssai = () => 1;\n',
    }));
    egal(r.statut('cibles par nom'), 'echec', 'une entrée de menu qui vise une const : échec');
    verifier(/const/.test(r.detail('cibles par nom')), 'la raison dit « const »');
  }
  {
    const r = verification(projetEssai({ ...PROPRE, 'Reprise.gs': "function relancer() { ScriptApp.newTrigger('inexistante').timeBased().after(60000).create(); }\n" }));
    egal(r.statut('cibles par nom'), 'echec', 'un déclencheur vers une fonction inexistante : échec');
  }
  {
    const r = verification(projetEssai({
      ...PROPRE,
      'Page.html': '<script>google.script.run.withSuccessHandler(afficher).calculer_(2);</script>',
    }));
    egal(r.statut('cibles par nom'), 'echec', 'google.script.run vers une fonction finissant par « _ » : échec');
  }

  console.log('— E. Services avancés');
  {
    const code = { ...PROPRE, 'Drive.gs': "function lister() { return Drive.Files.list({ q: 'x' }); }\n" };
    egal(verification(projetEssai(code)).statut('services avancés'), 'echec', 'Drive employé sans être activé : échec');
    const active = verification(projetEssai(code, {
      manifeste: { dependencies: { enabledAdvancedServices: [{ userSymbol: 'Drive', serviceId: 'drive', version: 'v3' }] } },
    }));
    egal(active.statut('services avancés'), 'ok', 'activé dans le manifeste : rien');
    const chaine = verification(projetEssai({ ...PROPRE, 'Aide.gs': "const AIDE_ = 'champ « files » pour Drive.Files.list';\n" }));
    verifier(chaine.statut('services avancés') !== 'echec', 'une mention dans une chaîne n’est pas un appel');
  }

  console.log('— F. Types : énumérations et cliquet');
  {
    const r = verification(projetEssai({
      ...PROPRE,
      'Web.gs': "function doGet() {\n  return HtmlService.createHtmlOutput('x').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DENY);\n}\n",
    }));
    egal(r.statut('types'), 'echec', 'XFrameOptionsMode.DENY : échec de types');
    egal(r.statut('motifs'), 'echec', 'et échec de motif, même sans TypeScript');
  }
  {
    const r = verification(projetEssai({
      ...PROPRE,
      'Droits.gs': 'function droit() { return DriveApp.Permission.FILE_ORGANIZER; }\n',
    }));
    egal(r.statut('types'), 'ok', 'FILE_ORGANIZER existe (doc Google) : le correctif de types le connaît');
  }
  {
    const dossier = projetEssai({ ...PROPRE, 'Erreur.gs': "function lever() { const e = new Error('x'); e.codeMetier = 1; throw e; }\n" });
    egal(verification(dossier).statut('types'), 'echec', 'un signalement ordinaire non examiné fait échouer');
    verification(dossier, '--accepter');
    egal(verification(dossier).statut('types'), 'ok', 'après --accepter, il est figé');
    fs.appendFileSync(path.join(dossier, 'apps-script', 'Erreur.gs'),
      "function lever2() { const e = new Error('y'); e.autreChamp = 2; throw e; }\n");
    egal(verification(dossier).statut('types'), 'echec', 'un signalement nouveau fait de nouveau échouer');
    const config = JSON.parse(fs.readFileSync(path.join(dossier, 'verifier.json'), 'utf8'));
    egal(Object.keys(config.typesAcceptes).length, 1, 'verifier.json garde la signature figée');
  }
  {
    // Un grave ne se fige pas par --accepter.
    const dossier = projetEssai({ 'Aaa.gs': 'const S_ = O_;\n', 'Zzz.gs': 'const O_ = 1;\n' });
    verification(dossier, '--accepter');
    egal(verification(dossier).statut('types'), 'echec', '--accepter ne fige pas un défaut grave');
  }

  console.log('— G. Motifs, version, secrets');
  {
    const r = verification(projetEssai({ ...PROPRE, 'Dates.gs': 'const jour_ = (v) => String(v).slice(0, 10);\n' }));
    egal(r.statut('motifs'), 'echec', 'String(v).slice(0, 10) : échec');
    const commente = verification(projetEssai({ ...PROPRE, 'Dates.gs': '// jamais String(v).slice(0, 10)\nconst jour_ = (v) => v;\n' }));
    egal(commente.statut('motifs'), 'ok', 'le même motif en commentaire : rien');
    const cle = verification(projetEssai({ ...PROPRE, 'Api.gs': 'const url_ = (cle) => `https://x.googleapis.com/v1?key=${cle}`;\n' }));
    egal(cle.statut('motifs'), 'echec', 'clé d’API dans l’URL : échec');
  }
  {
    const dossier = projetEssai(PROPRE, { version: '2.0.0' });
    fs.writeFileSync(path.join(dossier, 'VERSION'), '2.1.0\n');
    egal(verification(dossier).statut('version'), 'echec', 'VERSION et constante divergent : échec');
  }
  {
    const r = verification(projetEssai({ ...PROPRE, 'Cle.gs': "const CLE_ = 'AIzaSyA1234567890abcdefghijklmnopqrstuv';\n" })); // gitleaks:allow — fausse clé, fabriquée pour éprouver la détection des secrets
    egal(r.statut('secrets'), 'echec', 'une clé AIza… en clair : échec');
    const faux = verification(projetEssai({ ...PROPRE, 'Essai.gs': "const JETON_ESSAI_ = 'ya29.jeton-de-test';\n" }));
    egal(faux.statut('secrets'), 'ok', 'un faux jeton de test court n’est pas un secret');
  }

  console.log('— H. .claspignore suit micromatch, sans matchBase');
  {
    const P = require('../outils/projets');
    const motifs = ['**/**', '!appsscript.json', '!*.gs'].map((l) => ({ negation: l.startsWith('!'), re: P.motifEnRegex(l.replace(/^!/, '')) }));
    egal(P.estIgnore('Code.gs', motifs), false, '*.gs réautorise un fichier de la racine');
    egal(P.estIgnore('outils/Code.gs', motifs), true, 'mais pas un fichier d’un sous-dossier');
  }

  console.log('— I. Le cœur du simulateur refuse ce que Google refuse');
  {
    const { installerFauxGoogle, chargerProjet, FAUX_GOOGLE_SOCLE_VERSION } = require('./faux-google-socle');
    egal(FAUX_GOOGLE_SOCLE_VERSION, VERSION, 'le simulateur porte la version du socle');
    const sandbox = {};
    const contexte = vm.createContext(sandbox);
    const DateContexte = vm.runInContext('Date', contexte);
    const faux = installerFauxGoogle(sandbox, { DateContexte });
    const feuille = faux.ajouterFeuille('Données');
    leve(() => feuille.getRange(1, 1, 2, 2).setValues([[1, 2]]), /The number of rows in the data does not match/, 'dimensions fausses');
    leve(() => feuille.getRange(1, 1, 1, 2).setValues([[1, undefined]]), /Invalid argument/, 'undefined refusé');
    feuille.getRange(1, 1, 1, 3).setValues([['2026-09-06', '42', '\'007']]);
    const [[date, nombre, texte]] = feuille.getRange(1, 1, 1, 3).getValues();
    verifier(date instanceof DateContexte, 'une chaîne yyyy-MM-dd revient en Date du bac à sable');
    egal(nombre, 42, 'une chaîne de chiffres revient en nombre');
    egal(texte, '007', 'l’apostrophe force le texte et ne revient pas');
    leve(() => sandbox.PropertiesService.getScriptProperties().setProperty('k', 'x'.repeat(9 * 1024 + 1)), /Argument too large/, '9 Ko par propriété');
    egal(sandbox.HtmlService.XFrameOptionsMode.DENY, undefined, 'XFrameOptionsMode.DENY n’existe pas');
    egal(sandbox.Utilities.formatDate(new DateContexte(2026, 8, 6, 12), 'Europe/Paris', 'd MMMM yyyy'), '6 September 2026',
      'formatDate rend le mois en anglais');
    verifier(sandbox.Utilities.computeDigest('SHA_256', 'a').some((o) => o < 0), 'computeDigest rend des octets signés');
    for (let i = 0; i < 20; i += 1) sandbox.ScriptApp.newTrigger('f').timeBased().after(1000).create();
    leve(() => sandbox.ScriptApp.newTrigger('f').timeBased().after(1000).create(), /too many triggers/, '21e déclencheur refusé');

    const autonome = {};
    installerFauxGoogle(autonome, { DateContexte: vm.runInContext('Date', vm.createContext(autonome)), options: { documentAccessible: false } });
    egal(autonome.PropertiesService.getDocumentProperties(), null, 'sans document lié, getDocumentProperties rend null');
    egal(autonome.LockService.getDocumentLock(), null, 'et getDocumentLock aussi');

    const source = path.join(projetEssai({ 'Aaa.gs': 'const S_ = O_;\n', 'Zzz.gs': 'const O_ = 1;\n' }), 'apps-script');
    leve(() => chargerProjet(source), /O_/, 'chargerProjet lève comme Google quand l’ordre de clasp casse le chargement');
  }

  console.log('— J. Gabarit, publication, hook');
  {
    const profil = path.join(TEMPORAIRE, 'profil.json');
    const projets = path.join(TEMPORAIRE, 'projets');
    fs.mkdirSync(projets);
    fs.writeFileSync(profil, JSON.stringify({
      auteur: 'Auteur d’essai', fuseau: 'Europe/Paris', projets, socle: RACINE,
      licence: { spdx: 'Elastic-2.0', fichier: path.join(RACINE, 'LICENSE') },
    }));
    const env = { ...process.env, ATELIER_PROFIL: profil, GIT_AUTHOR_NAME: 'Essai', GIT_AUTHOR_EMAIL: 'essai@exemple.fr', GIT_COMMITTER_NAME: 'Essai', GIT_COMMITTER_EMAIL: 'essai@exemple.fr' };
    const creation = spawnSync(process.execPath, [path.join(OUTILS, 'nouveau-projet.js'), 'outil-essai', '--titre', 'Outil d’essai'], { encoding: 'utf8', env });
    egal(creation.status, 0, `nouveau-projet réussit${creation.status ? ` : ${creation.stderr}` : ''}`);
    const projet = path.join(projets, 'outil-essai');
    egal(fs.readFileSync(path.join(projet, 'LICENSE'), 'utf8'), fs.readFileSync(path.join(RACINE, 'LICENSE'), 'utf8'),
      'la licence est recopiée, jamais réécrite');
    verifier(!/\{\{/.test(fs.readFileSync(path.join(projet, 'apps-script', 'OutilEssai.gs'), 'utf8')), 'aucun gabarit laissé non rempli');
    verifier(fs.readFileSync(path.join(projet, '.git', 'hooks', 'pre-commit'), 'utf8').includes('socle-apps-script:pre-commit'), 'le hook est posé');

    // Le banc du gabarit doit échouer si l'on réintroduit le défaut qu'il garde.
    const principal = path.join(projet, 'apps-script', 'OutilEssai.gs');
    const sain = fs.readFileSync(principal, 'utf8');
    fs.writeFileSync(principal, sain.replace('function aProposDeOutilEssai() {', 'const aProposDeOutilEssai = () => {')
      .replace("ui.ButtonSet.OK);\n}", "ui.ButtonSet.OK);\n};"));
    const bancCasse = spawnSync(process.execPath, ['banc/test.js'], { cwd: projet, encoding: 'utf8' });
    egal(bancCasse.status, 1, 'le banc du gabarit attrape une entrée de menu en const');
    fs.writeFileSync(principal, sain);

    // publier : refuse sans journal, puis publie en local avec « Non publié ».
    const publier = (...a) => spawnSync(process.execPath, [path.join(OUTILS, 'publier.js'), projet, ...a], { encoding: 'utf8', env });
    const sansJournal = publier('minor');
    egal(sansJournal.status, 1, 'publier refuse sans entrée de journal');
    verifier(/ce n’est pas à un outil de l’inventer/.test(sansJournal.stderr + sansJournal.stdout), 'et dit pourquoi');
    const journal = path.join(projet, 'CHANGELOG.md');
    fs.writeFileSync(journal, fs.readFileSync(journal, 'utf8').replace('## [0.1.0]', '## [Non publié]\n\n### Ajouté\n\n- Essai.\n\n## [0.1.0]'));
    spawnSync('git', ['commit', '-qam', 'journal'], { cwd: projet, env });
    const plan = publier('minor', '--sans-clasp');
    egal(plan.status, 0, `le plan passe${plan.status ? ` : ${plan.stdout}${plan.stderr}` : ''}`);
    egal(fs.readFileSync(path.join(projet, 'VERSION'), 'utf8').trim(), '0.1.0', 'le plan ne touche à rien');
    const application = publier('minor', '--sans-clasp', '--appliquer');
    egal(application.status, 0, `l’application réussit${application.status ? ` : ${application.stdout}${application.stderr}` : ''}`);
    egal(fs.readFileSync(path.join(projet, 'VERSION'), 'utf8').trim(), '0.2.0', 'VERSION montée');
    verifier(fs.readFileSync(principal, 'utf8').includes("OUTIL_ESSAI_VERSION_ = '0.2.0'"), 'la constante suit');
    verifier(/## \[0\.2\.0\] - \d{4}-\d{2}-\d{2}/.test(fs.readFileSync(journal, 'utf8')), 'le journal est daté');
    egal(spawnSync('git', ['tag'], { cwd: projet, encoding: 'utf8' }).stdout.trim(), 'v0.2.0', 'le tag est posé');

    // equiper n'écrase pas un hook qu'il n'a pas posé.
    const hook = path.join(projet, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\necho hook maison\n');
    spawnSync(process.execPath, [path.join(OUTILS, 'equiper.js'), projet], { encoding: 'utf8', env });
    egal(fs.readFileSync(hook, 'utf8'), '#!/bin/sh\necho hook maison\n', 'un hook étranger est laissé tel quel');
  }
} finally {
  fs.rmSync(TEMPORAIRE, { recursive: true, force: true });
}

console.log(`\n${reussis} assertion(s) passée(s), ${echecs.length} échec(s).`);
echecs.forEach((e) => console.log(`  ✗ ${e}`));
process.exit(echecs.length ? 1 : 0);
