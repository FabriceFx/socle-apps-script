// État du socle dans les projets — se lance hors de Google :
//
//     node outils/etat.js [dossier des projets]
//
// Recopier un module, c'est accepter qu'il puisse diverger. Cet outil rend la
// divergence visible plutôt que de la nier : pour chaque projet, il dit quels
// modules du socle y sont embarqués, s'ils sont encore identiques à la source,
// et surtout **ce qui reste à reprendre** — les fonctions écrites à la main
// que le socle couvre désormais.
//
// Il ne modifie rien. C'est un rapport, pas un outil de synchronisation : la
// décision de recopier appartient à celui qui connaît le projet.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RACINE = path.join(__dirname, '..');
const DOSSIER_MODULES = path.join(RACINE, 'modules');
const PROJETS = path.resolve(process.argv[2] || path.join(RACINE, '..'));

const empreinte = (texte) => crypto.createHash('sha256')
  .update(texte.replace(/\r\n/g, '\n').trimEnd()).digest('hex').slice(0, 12);

const modules = fs.readdirSync(DOSSIER_MODULES)
  .filter((n) => n.endsWith('.gs') || n.endsWith('.html'))
  .map((nom) => {
    const source = fs.readFileSync(path.join(DOSSIER_MODULES, nom), 'utf8');
    return {
      nom,
      objet: nom.replace(/\.(gs|html)$/, ''),
      source,
      empreinte: empreinte(source),
      version: (/_VERSION_ = '([^']+)'|--socle-version: '([^']+)'|version: '([^']+)'/.exec(source) || []).slice(1).find(Boolean),
    };
  });
// Le cœur du simulateur des bancs (v0.13) se suit comme un module : une copie
// dans banc/ qui a dérivé se voit ici, au même titre qu'un SocleDates.gs.
{
  const source = fs.readFileSync(path.join(RACINE, 'banc', 'faux-google-socle.js'), 'utf8');
  modules.push({
    nom: 'faux-google-socle.js',
    objet: 'faux-google-socle',
    source,
    empreinte: empreinte(source),
    version: (/_VERSION_ = '([^']+)'/.exec(source) || [])[1],
  });
}

/**
 * Ce que le socle remplace, et comment le reconnaître dans un projet.
 *
 * Les motifs visent l'usage direct des services, pas les noms de fonctions :
 * un projet peut appeler sa normalisation de date « dateLisible_ » ou
 * « formaterHorodatage_ », mais il finira toujours par appeler
 * `Utilities.formatDate`.
 */
const REPRISES = [
  { module: 'SocleDates', motif: /Utilities\.formatDate/g, quoi: 'formatage de date en ligne' },
  { module: 'SocleDates', motif: /new Date\((?!\))[^)]*\)/g, quoi: 'analyse de date devinée' },
  { module: 'SocleTexte', motif: /replace\(\/&\/g/g, quoi: 'échappement HTML écrit à la main' },
  { module: 'SocleFeuilles', motif: /getSheetByName\(/g, quoi: 'résolution d’onglet' },
  { module: 'SocleFeuilles', motif: /\.setValue\((?!s)/g, quoi: 'écriture cellule par cellule' },
  { module: 'SocleReprises', motif: /Utilities\.sleep/g, quoi: 'attente entre deux essais' },
  { module: 'SocleReprises', motif: /UrlFetchApp\.fetch/g, quoi: 'appel HTTP sans reprise' },
  { module: 'SocleCourriel', motif: /MailApp\.sendEmail/g, quoi: 'envoi non classé' },
  { module: 'SocleErreurs', motif: /catch\s*\([^)]*\)\s*\{\s*(?:\/\*[^*]*\*\/\s*|\/\/[^\n]*\n\s*)?\}/g,
    quoi: 'catch qui avale sans compter' },
  { module: 'SocleErreurs', motif: /throw new Error\(/g, quoi: 'message levé, remède à vérifier' },
  { module: 'SocleWeb', motif: /HtmlService\.create(?:HtmlOutput|Template)FromFile/g,
    quoi: 'page servie à la main' },
  { module: 'SocleWeb', motif: /google\.script\.run/g, quoi: 'appel client sans enveloppe' },
  { module: 'SocleStyle', motif: /<style/g, quoi: 'feuille de style propre au projet' },
];

const fichiersGs = (dossier) => {
  const sortie = [];
  const parcourir = (courant) => {
    fs.readdirSync(courant, { withFileTypes: true }).forEach((entree) => {
      if (entree.name === 'node_modules' || entree.name.startsWith('.')) return;
      const complet = path.join(courant, entree.name);
      if (entree.isDirectory()) parcourir(complet);
      else if (entree.name.endsWith('.gs') || entree.name.endsWith('.html')
        || entree.name === 'faux-google-socle.js') sortie.push(complet);
    });
  };
  parcourir(dossier);
  return sortie;
};

const projets = fs.readdirSync(PROJETS, { withFileTypes: true })
  // Ni le dépôt du socle lui-même, ni le dossier d'essai qu'il engendre à côté :
  // ce ne sont pas des projets à reprendre.
  .filter((e) => e.isDirectory() && !e.name.startsWith('.')
    && e.name !== path.basename(RACINE) && e.name !== 'socle-essai')
  .map((e) => path.join(PROJETS, e.name))
  .filter((d) => fichiersGs(d).length > 0);

console.log(`Socle v${modules[0].version} — ${modules.length} modules`);
console.log(`Projets examinés dans ${PROJETS}\n`);

let totalARecopier = 0;
projets.forEach((dossier) => {
  const fichiers = fichiersGs(dossier);
  const parNom = new Map(fichiers.map((f) => [path.basename(f), f]));
  // Le simulateur n'est pas du code de projet : ses « throw new Error » ne sont
  // pas des messages à reprendre.
  const source = fichiers.filter((f) => !f.endsWith('.js')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');

  console.log(`\x1b[1m${path.basename(dossier)}\x1b[0m  (${fichiers.length} fichiers .gs)`);

  const embarques = [];
  modules.forEach((module) => {
    const copie = parNom.get(module.nom);
    if (!copie) return;
    const contenu = fs.readFileSync(copie, 'utf8');
    const version = (/_VERSION_ = '([^']+)'|--socle-version: '([^']+)'|version: '([^']+)'/.exec(contenu) || []).slice(1).find(Boolean);
    const identique = empreinte(contenu) === module.empreinte;
    embarques.push(module.objet);
    if (identique) {
      console.log(`  ✓ ${module.nom.padEnd(20)} v${version} — identique à la source`);
    } else {
      totalARecopier += 1;
      console.log(`  ! ${module.nom.padEnd(20)} v${version || '?'} — \x1b[33mdiverge de la source\x1b[0m`);
    }
  });
  if (embarques.length === 0) console.log('  · aucun module du socle');

  // Ce qui reste écrit à la main et que le socle couvrirait.
  const restes = new Map();
  REPRISES.forEach(({ module, motif, quoi }) => {
    if (embarques.includes(module)) return;
    const compte = (source.match(motif) || []).length;
    if (compte === 0) return;
    const cle = `${module} — ${quoi}`;
    restes.set(cle, (restes.get(cle) || 0) + compte);
  });
  if (restes.size > 0) {
    const total = [...restes.values()].reduce((a, b) => a + b, 0);
    console.log(`  à reprendre : ${total} occurrence(s)`);
    [...restes.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([quoi, compte]) => console.log(`      ${String(compte).padStart(4)}  ${quoi}`));
  }
  console.log('');
});

if (totalARecopier > 0) {
  console.log(`\x1b[33m${totalARecopier} copie(s) divergente(s)\x1b[0m — `
    + 'relire la différence avant de recopier : c’est peut-être le projet qui a raison.');
} else {
  console.log('Aucune copie divergente.');
}
