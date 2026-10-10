// Prépare le dossier à pousser dans un classeur d'essai — hors de Google :
//
//     node outils/preparer-essai.js
//
// Le dossier est **assemblé depuis la source**, jamais recopié à la main : un
// dossier d'essai qui porterait sa propre copie des modules finirait par
// tester autre chose que ce que le socle contient.
//
// Deux différences avec le projet autonome, et elles sont voulues :
//
//   - **les fichiers sont mis à plat.** clasp transforme un sous-dossier en
//     préfixe de nom : `modules/SocleStyle.html` devient le fichier
//     `modules/SocleStyle`, et `SocleWeb.inclure('SocleStyle')` échoue. Un
//     projet hôte ordinaire n'aura pas de sous-dossier ; l'essai doit donc se
//     faire dans les mêmes conditions ;
//   - **un menu est ajouté**, pour lancer le contrôle depuis le classeur.
//     `onOpen()` est un déclencheur simple : il n'y a rien à installer, et le
//     contrôle s'exécute sous l'identité de qui l'ouvre.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const RACINE = path.join(__dirname, '..');

/**
 * Le dossier d'essai vit **à côté** du dépôt du socle, jamais dedans.
 *
 * `clasp` remonte les dossiers parents pour trouver un `.clasp.json`. Un
 * dossier `essai/` imbriqué dans le dépôt trouverait celui du projet autonome,
 * refuserait de créer le classeur — « Project file already exists » — et un
 * `clasp push` lancé depuis là repousserait le projet autonome sans prévenir,
 * en affichant des chemins en `../`. Payé une fois.
 */
const SORTIE = path.join(RACINE, '..', 'socle-essai');
const version = fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim();

const MENU = `/**
 * Menu du classeur d'essai — assemblé par outils/preparer-essai.js.
 *
 * Ne pas modifier ici : toute retouche serait perdue à la prochaine
 * préparation. Le gabarit vit dans le script qui l'écrit.
 *
 * \`onOpen()\` est un déclencheur simple : le menu apparaît sans rien installer,
 * et chaque contrôle s'exécute sous l'identité de qui l'a déclenché.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Socle')
    .addItem('Contrôler le socle', 'controlerDepuisLeMenu')
    .addToUi();
}

function controlerDepuisLeMenu() {
  const ui = SpreadsheetApp.getUi();
  const bilan = controlerLeSocle();
  // Le rapport tient dans une alerte tant qu'il reste court ; au-delà, on
  // renvoie au journal plutôt que d'afficher un texte coupé au milieu.
  const rapport = bilan.rapport.length < 1500
    ? bilan.rapport
    : \`\${bilan.reussites} réussi(s), \${bilan.echecs} échec(s), \${bilan.ignores} non testé(s).\\n\\n\`
      + 'Le détail est dans Extensions > Apps Script > Exécutions.';
  ui.alert('Contrôle du socle', rapport, ui.ButtonSet.OK);
}
`;

const LISEZMOI = `# Classeur d'essai du socle — version ${version}

Ce dossier est **généré** par \`node outils/preparer-essai.js\`. Ne rien y
modifier à la main : la prochaine préparation écraserait la retouche.

Il existe pour couvrir les deux seules choses qu'un projet autonome ne peut pas
tester : \`SocleFeuilles\`, qui a besoin d'un classeur, et le magasin de
propriétés « document », qui n'existe que pour un script lié.

## Marche à suivre

\`\`\`bash
cd ../socle-essai
clasp create --type sheets --title "Socle — classeur d'essai"
clasp push
\`\`\`

Ce dossier est **à côté** du dépôt du socle, et non dedans : \`clasp\` remonte
les dossiers parents pour trouver un \`.clasp.json\`, et il trouverait celui du
projet autonome. Un \`clasp push\` lancé depuis un dossier imbriqué repousse le
projet autonome sans prévenir — les chemins affichés commencent alors par
\`../\`, c'est le signe qui ne trompe pas.

\`clasp create\` crée le classeur **et** son script lié, puis écrit
\`.clasp.json\` et \`appsscript.json\` ici. Ne pas déclarer de \`oauthScopes\`
dans le manifeste : Apps Script les déduit du code, et en déclarer à la main
revient à en demander plus que nécessaire.

Ouvrez ensuite le classeur : le menu **Socle > Contrôler le socle** apparaît.
La première exécution demande une autorisation — le contrôle touche aux
propriétés, aux déclencheurs et au quota d'envoi.

## Ce que le contrôle va faire dans ce classeur

Il crée un onglet \`socleControleTemporaireOnglet\`, y écrit une ligne, la
relit, puis **supprime l'onglet** dans un \`finally\` — même s'il échoue en
route. Il pose et retire un déclencheur ponctuel, écrit et efface une propriété
temporaire dans chacun des trois magasins. **Il n'envoie aucun courriel.**

Le point qu'on vient vérifier ici, et que le banc ne fait que simuler : qu'une
chaîne de date écrite dans une cellule en ressorte en objet \`Date\`.

## Après l'essai

Le classeur ne sert plus à rien : il peut être jeté. Ce dossier n'est versionné
nulle part — il se réengendre d'une commande, et seul
\`socle-apps-script/outils/preparer-essai.js\` est suivi par git.
`;

const CLASPIGNORE = `**/**
!appsscript.json
!*.gs
!*.html
`;

// ---------------------------------------------------------------------------

// Ce qui appartient à clasp survit à la régénération.
//
// Payé une fois : la première version effaçait le dossier entier, donc le
// `.clasp.json` écrit par `clasp create` — et le lien vers le classeur d'essai
// avec lui. Le classeur restait dans Drive, mais plus rien ne le désignait.
const APARTIENT_A_CLASP = ['.clasp.json', 'appsscript.json'];
const conserves = {};
APARTIENT_A_CLASP.forEach((nom) => {
  const complet = path.join(SORTIE, nom);
  if (fs.existsSync(complet)) conserves[nom] = fs.readFileSync(complet, 'utf8');
});

fs.rmSync(SORTIE, { recursive: true, force: true });
fs.mkdirSync(SORTIE, { recursive: true });

Object.keys(conserves).forEach((nom) => {
  fs.writeFileSync(path.join(SORTIE, nom), conserves[nom], 'utf8');
});

const source = [];
const poses = [];

fs.readdirSync(path.join(RACINE, 'modules'))
  .filter((nom) => nom.endsWith('.gs') || nom.endsWith('.html'))
  .sort()
  .forEach((nom) => {
    const contenu = fs.readFileSync(path.join(RACINE, 'modules', nom), 'utf8');
    fs.writeFileSync(path.join(SORTIE, nom), contenu, 'utf8');
    if (nom.endsWith('.gs')) source.push(contenu);
    poses.push(nom);
  });

['SocleControle.gs'].forEach((nom) => {
  const contenu = fs.readFileSync(path.join(RACINE, 'outils', nom), 'utf8');
  fs.writeFileSync(path.join(SORTIE, nom), contenu, 'utf8');
  source.push(contenu);
  poses.push(nom);
});

fs.writeFileSync(path.join(SORTIE, 'Menu.gs'), MENU, 'utf8');
source.push(MENU);
poses.push('Menu.gs');

fs.writeFileSync(path.join(SORTIE, '.claspignore'), CLASPIGNORE, 'utf8');
fs.writeFileSync(path.join(SORTIE, 'LISEZMOI.md'), LISEZMOI, 'utf8');

// ---- le dossier se vérifie avant d'être livré ------------------------------

const concatene = source.join('\n');
const ennuis = [];

try {
  new vm.Script(concatene, { filename: 'essai.gs' });
} catch (erreur) {
  ennuis.push(`syntaxe du projet concaténé : ${erreur.message}`);
}

const vus = new Map();
source.forEach((contenu, rang) => {
  contenu.split('\n').forEach((ligne) => {
    const trouve = /^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)|^function\s+([A-Za-z_$][\w$]*)/
      .exec(ligne);
    if (!trouve) return;
    const nom = trouve[1] || trouve[2];
    const fichier = poses.filter((p) => p.endsWith('.gs'))[rang];
    if (vus.has(nom)) ennuis.push(`nom global en double : ${nom} (${vus.get(nom)} et ${fichier})`);
    vus.set(nom, fichier);
  });
});

// Le piège inverse de celui du projet autonome : à plat, le fichier de style
// s'appelle bien « SocleStyle ».
if (!fs.existsSync(path.join(SORTIE, 'SocleStyle.html'))) {
  ennuis.push('SocleStyle.html absent du dossier');
}

// Le fuseau posé par `clasp create` est celui du compte, pas celui du classeur.
// Six heures d'écart suffisent à ranger une date la veille.
const manifeste = conserves['appsscript.json'];
if (manifeste) {
  const fuseau = (/"timeZone":\s*"([^"]+)"/.exec(manifeste) || [])[1];
  const attendu = (/"timeZone":\s*"([^"]+)"/.exec(
    fs.readFileSync(path.join(RACINE, 'appsscript.json'), 'utf8')) || [])[1];
  if (fuseau && attendu && fuseau !== attendu) {
    console.log(`\n  ⚠ fuseau du classeur d'essai : ${fuseau}, celui du socle : ${attendu}.`);
    console.log('    Corrigez « timeZone » dans essai/appsscript.json avant de pousser :');
    console.log('    une date normalisée dans le mauvais fuseau change de jour près de minuit.');
  }
}

console.log(`Dossier d'essai préparé : ${SORTIE}`);
console.log(`  socle ${version} — ${poses.length} fichiers, tous à plat`);
poses.forEach((nom) => console.log(`    ${nom}`));

if (ennuis.length) {
  console.log('\nCe dossier ne se chargerait PAS dans Apps Script :');
  ennuis.forEach((e) => console.log(`  · ${e}`));
  process.exit(1);
}
console.log('\nLe projet concaténé se charge, aucun nom global en double.');
console.log('\nSuite, depuis ce dossier — et non depuis le dépôt du socle :');
console.log(`  cd ${path.relative(process.cwd(), SORTIE)}`);
console.log('  clasp create --type sheets --title "Socle — classeur d\'essai"');
console.log('  clasp push');
