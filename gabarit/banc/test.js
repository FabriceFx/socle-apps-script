// Banc d'essai de {{TITRE}} — se lance hors de Google :
//
//     node banc/test.js
//
// Les services Google sont simulés par banc/faux-google-socle.js, recopié du
// socle : il refuse ce que le vrai refuse. Ce qui est propre à ce projet
// (une API, un service avancé) s'ajoute ici, par-dessus.
//
// Toute correction de défaut s'accompagne du cas qui l'aurait attrapé, et la
// réintroduction du défaut doit faire échouer le banc.

const fs = require('fs');
const path = require('path');
const { chargerProjet } = require('./faux-google-socle');

const RACINE = path.join(__dirname, '..');
const SOURCE = path.join(RACINE, 'apps-script');

// Chez Google, l'heure locale d'un script est celle du fuseau de
// appsscript.json ; Node prend celui de la machine. Sans cette ligne, le banc
// passe sur un poste réglé sur le bon fuseau et échoue sur la CI en UTC — ou
// pire, l'inverse. Le fuseau est imposé avant toute création de Date.
process.env.TZ = JSON.parse(fs.readFileSync(path.join(SOURCE, 'appsscript.json'), 'utf8')).timeZone || 'UTC';

let reussis = 0;
const echecs = [];
const verifier = (condition, quoi) => {
  if (condition) reussis += 1;
  else echecs.push(quoi);
};
const egal = (obtenu, attendu, quoi) => verifier(JSON.stringify(obtenu) === JSON.stringify(attendu),
  `${quoi} — obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`);

console.log('— A. Le projet se charge, dans l’ordre de clasp');
// chargerProjet lève si un fichier lit au premier niveau une constante qu'un
// fichier poussé après lui déclare : c'est ce qui arriverait chez Google.
const projet = chargerProjet(SOURCE);
verifier(projet.fichiers.length > 0, 'au moins un .gs');

console.log('— B. La version');
const version = fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim();
egal(projet.lire('{{CONSTANTE}}_VERSION_'), version, 'la constante de version vaut le fichier VERSION');

console.log('— C. Le menu');
projet.lire('onOpen')();
const [menu] = projet.faux.journal.menus;
verifier(menu && menu.entrees.length > 0, 'onOpen pose un menu');
// Une entrée de menu est trouvée par son nom sur l'objet global : seules les
// « function » déclarées y figurent. Une const fléchée y serait introuvable.
(menu ? menu.entrees : []).filter((e) => e.fonction).forEach(({ fonction }) => {
  verifier(typeof projet.contexte[fonction] === 'function',
    `l’entrée de menu « ${fonction} » vise une function déclarée`);
});

console.log('— D. À propos');
projet.lire('aProposDe{{PREFIXE}}')();
verifier(projet.faux.journal.alertes.some((a) => String(a.message).includes(version)),
  'À propos affiche la version');

console.log(`\n${reussis} réussi(s), ${echecs.length} échec(s).`);
echecs.forEach((e) => console.log(`  ✗ ${e}`));
process.exit(echecs.length ? 1 : 0);
