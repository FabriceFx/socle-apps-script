#!/usr/bin/env node
// Crée un projet Apps Script aux conventions — se lance hors de Google :
//
//     node outils/nouveau-projet.js <dossier> --titre "Titre lisible" [--prefixe Nom]
//         [--clasp]    crée aussi le classeur et son projet lié chez Google (clasp create-script)
//         [--github]   crée aussi le dépôt GitHub, PRIVÉ, au nom du profil (gh repo create)
//
// Introduit en v0.13. Ce qu'il pose : README et DEMARRAGE (deux textes, deux
// publics), CHANGELOG, VERSION, LICENSE, un point d'entrée avec « À propos »
// qui affiche la version, un banc qui charge les fichiers dans l'ordre de
// clasp, la CI, le hook Git, verifier.json.
//
// **L'identité vient du profil, jamais du code.** Auteur, licence, compte
// GitHub, fuseau : chez soi, un projet sort en Elastic License 2.0 au nom de
// son auteur ; chez un employeur, il sort au nom de l'employeur, sous sa
// licence ou sans licence publique. Un outil qui aurait l'un des deux en dur
// finirait par attribuer à quelqu'un un code qui n'est pas le sien.
//
// La licence n'est jamais écrite par l'outil : il **recopie** le fichier que
// le profil désigne. Une licence ne se paraphrase pas.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('./projets');

const args = process.argv.slice(2);
const valeur = (option) => {
  const i = args.indexOf(option);
  return i === -1 ? null : args[i + 1];
};
const avecClasp = args.includes('--clasp');
const avecGithub = args.includes('--github');
const nom = args.find((a, i) => !a.startsWith('--') && !['--titre', '--prefixe'].includes(args[i - 1]));

const arreter = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

if (!nom || !/^[a-z0-9][a-z0-9-]*$/.test(nom)) {
  arreter('Donner un nom de dossier en kebab-case : node outils/nouveau-projet.js mon-outil --titre "Mon outil"');
}
const titre = valeur('--titre');
if (!titre) arreter('--titre est obligatoire : c’est le nom du menu et de l’en-tête du README.');

const profil = P.lireProfil();
if (!profil.existe) {
  arreter(`Pas de profil (${profil.chemin}). Il dit à qui attribuer le code : lancer installer.sh de l’atelier, `
    + 'ou recopier profil.exemple.json et le remplir.');
}
['auteur', 'fuseau', 'licence'].forEach((cle) => {
  if (profil[cle] === undefined) arreter(`Le profil n’a pas de clé « ${cle} ». Voir profil.exemple.json.`);
});

// Le préfixe nomme la constante de version et les fonctions d'entrée :
// « jamais de nom global court ou générique », puisque deux projets qui se
// recopient des modules ne doivent pas se marcher dessus.
const prefixe = valeur('--prefixe')
  || nom.split('-').map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join('');
if (!/^[A-Z][A-Za-z0-9]+$/.test(prefixe)) arreter(`Préfixe invalide : ${prefixe} (PascalCase attendu).`);
const constante = prefixe.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

const cible = path.join(profil.projets, nom);
if (fs.existsSync(cible)) arreter(`${cible} existe déjà. Un préparateur ne détruit pas ce qu’il n’a pas écrit.`);

// --- La licence ----------------------------------------------------------------

const licence = profil.licence || {};
let fichierLicence = null;
if (licence.fichier) {
  fichierLicence = P.developper(licence.fichier);
  if (!fs.existsSync(fichierLicence)) arreter(`Licence introuvable : ${fichierLicence} (profil → licence.fichier).`);
}
const texteLicence = licence.spdx
  ? `${licence.spdx}${fichierLicence ? ' — voir [LICENSE](LICENSE)' : ''}. ${licence.mention || ''}`.trim()
  : (licence.mention || 'Usage interne. Aucune licence de diffusion.');
const texteLicenceEn = licence.spdx
  ? `${licence.spdx}${fichierLicence ? ' — see [LICENSE](LICENSE)' : ''}.`
  : 'Internal use. No distribution license.';

// --- Le gabarit ----------------------------------------------------------------

const VERSION_SOCLE = fs.readFileSync(path.join(P.RACINE_SOCLE, 'VERSION'), 'utf8').trim();
const remplacements = {
  NOM: nom,
  TITRE: titre,
  PREFIXE: prefixe,
  CONSTANTE: constante,
  AUTEUR: profil.site ? `${profil.auteur} (${profil.site})` : profil.auteur,
  FUSEAU: profil.fuseau,
  DATE: new Date().toLocaleDateString('sv-SE'),
  SOCLE_VERSION: VERSION_SOCLE,
  SOCLE_DEPOT: profil.depotSocle || 'OWNER/socle-apps-script',
  LICENCE_TEXTE: texteLicence,
  LICENCE_TEXTE_EN: texteLicenceEn,
};
const remplir = (texte) => texte.replace(/\{\{([A-Z_]+)\}\}/g, (m, cle) => {
  if (!(cle in remplacements)) throw new Error(`Gabarit : {{${cle}}} n’a pas de valeur.`);
  return remplacements[cle];
});
// Noms de fichiers : « gitignore » sans point dans le socle, pour qu'il ne
// s'applique pas au socle lui-même.
const RENOMMAGES = { gitignore: '.gitignore', editorconfig: '.editorconfig', 'Principal.gs': `${prefixe}.gs` };

const GABARIT = path.join(P.RACINE_SOCLE, 'gabarit');
const recopier = (depuis, vers) => {
  fs.mkdirSync(vers, { recursive: true });
  fs.readdirSync(depuis, { withFileTypes: true }).forEach((e) => {
    const source = path.join(depuis, e.name);
    const destination = path.join(vers, RENOMMAGES[e.name] || e.name);
    if (e.isDirectory()) {
      if (e.name === '.github' && !profil.depotSocle) return;   // pas de CI sans dépôt de socle connu
      recopier(source, destination);
    } else {
      fs.writeFileSync(destination, remplir(fs.readFileSync(source, 'utf8')));
    }
  });
};
recopier(GABARIT, cible);

fs.copyFileSync(path.join(P.RACINE_SOCLE, 'banc', 'faux-google-socle.js'), path.join(cible, 'banc', 'faux-google-socle.js'));
if (fichierLicence) fs.copyFileSync(fichierLicence, path.join(cible, 'LICENSE'));
fs.writeFileSync(path.join(cible, 'CLAUDE.md'), '# Conventions du projet\n\n'
  + 'Transverses dans `~/.claude/CLAUDE.md`. Ici, ce qui est propre à cet outil.\n');

console.log(`✓ ${cible} créé (${prefixe}, constante ${constante}_VERSION_)`);

// --- Ce qui se vérifie tout de suite --------------------------------------------

const lancer = (commande, arguments_) => spawnSync(commande,
  commande === 'clasp' ? [...P.argumentsClasp(profil), ...arguments_] : arguments_, { cwd: cible, encoding: 'utf8' });
const banc = spawnSync(process.execPath, ['banc/test.js'], { cwd: cible, encoding: 'utf8' });
if (banc.status !== 0) arreter(`Le banc du gabarit échoue — défaut du socle, pas du projet :\n${banc.stdout}${banc.stderr}`);
console.log('✓ banc vert');

lancer('git', ['init', '-q', '-b', 'main']);
lancer('git', ['add', '-A']);
const commit = lancer('git', ['commit', '-q', '-m', `Squelette de ${titre} (socle v${VERSION_SOCLE})`]);
if (commit.status !== 0) arreter(`git commit a échoué : ${commit.stderr}`);
spawnSync(process.execPath, [path.join(__dirname, 'equiper.js'), cible], { stdio: 'inherit' });

// --- Ce qui sort de la machine : seulement sur demande explicite -----------------

if (avecClasp) {
  const manifeste = fs.readFileSync(path.join(cible, 'apps-script', 'appsscript.json'), 'utf8');
  const creation = lancer('clasp', ['create-script', '--type', 'sheets', '--title', titre, '--rootDir', 'apps-script']);
  if (creation.status !== 0) arreter(`clasp create-script : ${creation.stderr || creation.stdout}`);
  // clasp create écrase appsscript.json avec le fuseau du compte Google, qui
  // n'est pas forcément le nôtre : on remet celui du gabarit, puis on pousse.
  fs.writeFileSync(path.join(cible, 'apps-script', 'appsscript.json'), manifeste);
  const pousse = lancer('clasp', ['push', '--force']);
  if (pousse.status !== 0) arreter(`clasp push : ${pousse.stderr || pousse.stdout}`);
  console.log('✓ classeur et projet créés chez Google, code poussé');
}
if (avecGithub) {
  if (!profil.github) arreter('Le profil n’a pas de clé « github » : à quel compte ou organisation le dépôt appartient-il ?');
  const depot = lancer('gh', ['repo', 'create', `${profil.github}/${nom}`, '--private', '--source', '.', '--push']);
  if (depot.status !== 0) arreter(`gh repo create : ${depot.stderr || depot.stdout}`);
  console.log(`✓ dépôt privé ${profil.github}/${nom} créé et poussé`);
}

console.log(`\nSuite : remplir le README (à quoi sert l’outil, pour qui), puis\n  cd ${cible} && node banc/test.js`);
