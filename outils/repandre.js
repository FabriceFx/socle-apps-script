// Répand une mise à jour du socle dans les projets qui l'embarquent :
//
//     node outils/repandre.js                       # rapport seul, ne touche à rien
//     node outils/repandre.js --appliquer <projet>  # recopie dans ce projet
//     node outils/repandre.js --appliquer toutes    # recopie partout
//
// Le pendant d'`etat.js`, qui dit ce qui diverge sans rien faire. Celui-ci
// fait la recopie — mais pas la décision.
//
// **Il refuse d'écraser une copie retouchée sur place.** Une divergence qui ne
// porte que sur le numéro de version est une copie en retard : on la remplace
// sans réfléchir. Une divergence qui porte sur autre chose est une copie que
// quelqu'un a modifiée — et c'est peut-être le projet qui a raison, comme
// l'a montré la dispersion de `withRetry_`, remontée dans le socle plutôt que
// l'inverse. Celle-là demande `--meme-si-retouchee`, et un coup d'œil au diff.

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const DOSSIER_MODULES = path.join(RACINE, 'modules');
const PROJETS = path.resolve(RACINE, '..');
const version = fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim();

const args = process.argv.slice(2);
const cible = args.includes('--appliquer') ? args[args.indexOf('--appliquer') + 1] : null;
const forcer = args.includes('--meme-si-retouchee');

const versionDe = (contenu) => (
  /_VERSION_ = '([^']+)'|--socle-version: '([^']+)'|version: '([^']+)'/.exec(contenu) || [])
  .slice(1).find(Boolean);

const modules = fs.readdirSync(DOSSIER_MODULES)
  .filter((n) => n.endsWith('.gs') || n.endsWith('.html'))
  .map((nom) => ({ nom, source: fs.readFileSync(path.join(DOSSIER_MODULES, nom), 'utf8') }))
  // Le cœur du simulateur se recopie dans banc/ comme un module dans le code :
  // même règle, une copie en retard se remplace, une copie retouchée non.
  .concat([{
    nom: 'faux-google-socle.js',
    source: fs.readFileSync(path.join(RACINE, 'banc', 'faux-google-socle.js'), 'utf8'),
  }]);

const normaliser = (texte) => texte.replace(/\r\n/g, '\n').trimEnd();

/**
 * Ce qui diffère entre une copie et la source, hors numéro de version.
 *
 * Comparaison par **ensembles de lignes**, et non position par position : une
 * seule ligne insérée décale tout ce qui suit, et une comparaison positionnelle
 * annoncerait soixante différences pour un ajout. Un chiffre qui gonfle un pour
 * soixante ne renseigne sur rien et pousse à ignorer l'avertissement.
 */
const ecarts = (copie, source) => {
  const versionSeule = /_VERSION_ = '|--socle-version: '|version: '/;
  const utiles = (texte) => normaliser(texte).split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l !== '' && !versionSeule.test(l));

  const restantes = (a, b) => {
    const compte = new Map();
    b.forEach((l) => compte.set(l, (compte.get(l) || 0) + 1));
    return a.filter((l) => {
      const n = compte.get(l) || 0;
      if (n === 0) return true;
      compte.set(l, n - 1);
      return false;
    });
  };

  const dansLaCopie = utiles(copie);
  const dansLaSource = utiles(source);
  const ajoutees = restantes(dansLaCopie, dansLaSource);
  const retirees = restantes(dansLaSource, dansLaCopie);

  return {
    total: normaliser(copie) === normaliser(source) ? 0 : 1,
    horsVersion: ajoutees.concat(retirees).length === 0 ? []
      : ajoutees.map((l) => ({ sens: 'en plus dans la copie', texte: l }))
        .concat(retirees.map((l) => ({ sens: 'absente de la copie', texte: l }))),
  };
};

const fichiersDe = (dossier) => {
  const sortie = [];
  const parcourir = (courant) => {
    fs.readdirSync(courant, { withFileTypes: true }).forEach((entree) => {
      if (entree.name === 'node_modules' || entree.name.startsWith('.')) return;
      const complet = path.join(courant, entree.name);
      if (entree.isDirectory()) parcourir(complet);
      else sortie.push(complet);
    });
  };
  parcourir(dossier);
  return sortie;
};

const projets = fs.readdirSync(PROJETS, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.')
    && e.name !== path.basename(RACINE) && e.name !== 'socle-essai')
  .map((e) => ({ nom: e.name, chemin: path.join(PROJETS, e.name) }))
  .map((projet) => {
    const fichiers = fichiersDe(projet.chemin);
    const copies = modules
      .map((module) => {
        const trouve = fichiers.find((f) => path.basename(f) === module.nom);
        if (!trouve) return null;
        const contenu = fs.readFileSync(trouve, 'utf8');
        return { module, chemin: trouve, contenu, ecart: ecarts(contenu, module.source) };
      })
      .filter(Boolean);
    return { ...projet, copies };
  })
  .filter((projet) => projet.copies.length > 0);

console.log(`Socle ${version} — ${projets.length} projet(s) l'embarquent\n`);

let aJour = 0;
let enRetard = 0;
let retouchees = 0;
let recopiees = 0;

projets.forEach((projet) => {
  const concerne = cible === 'toutes' || cible === projet.nom;
  console.log(`\x1b[1m${projet.nom}\x1b[0m`);

  projet.copies.forEach(({ module, chemin, ecart }) => {
    if (ecart.total === 0) {
      aJour += 1;
      console.log(`  ✓ ${module.nom.padEnd(22)} à jour`);
      return;
    }
    // Une copie qui déclare une version **antérieure** est simplement en
    // retard : que son contenu diffère est attendu, c'est même la raison de la
    // recopie. Confondre cela avec une retouche locale — ce que faisait la
    // première version de cet outil — bloquait toute mise à jour qui touchait
    // au code, c'est-à-dire toutes celles qui comptent.
    const versionCopie = versionDe(fs.readFileSync(chemin, 'utf8'));
    const enRetardParVersion = versionCopie && versionCopie !== version;

    if (ecart.horsVersion.length === 0 || enRetardParVersion) {
      enRetard += 1;
      if (concerne) {
        fs.writeFileSync(chemin, module.source, 'utf8');
        recopiees += 1;
        console.log(`  → ${module.nom.padEnd(22)} recopié `
          + `(${versionCopie || '?'} → ${version})`);
      } else {
        console.log(`  ! ${module.nom.padEnd(22)} \x1b[33men retard\x1b[0m `
          + `(${versionCopie || '?'} → ${version})`);
      }
      return;
    }
    retouchees += 1;
    if (concerne && forcer) {
      fs.writeFileSync(chemin, module.source, 'utf8');
      recopiees += 1;
      console.log(`  → ${module.nom.padEnd(22)} \x1b[31mrecopié malgré ${ecart.horsVersion.length} `
        + `ligne(s) retouchée(s)\x1b[0m`);
      return;
    }
    console.log(`  ⚠ ${module.nom.padEnd(22)} \x1b[31mretouché sur place\x1b[0m — `
      + `${ecart.horsVersion.length} ligne(s) hors version`);
    ecart.horsVersion.slice(0, 3).forEach((d) => {
      console.log(`      ${d.sens} : ${d.texte.trim().slice(0, 66)}`);
    });
    console.log('      Relisez avant de décider : c’est peut-être le projet qui a raison.');
  });
  console.log('');
});

console.log(`${aJour} à jour, ${enRetard} en retard, ${retouchees} retouchée(s) sur place.`);
if (recopiees > 0) {
  console.log(`\n${recopiees} fichier(s) recopié(s). \x1b[1mRelancez le banc du projet\x1b[0m `
    + 'avant de pousser : c’est lui qui dit si la mise à jour casse quelque chose.');
} else if (enRetard > 0 && !cible) {
  console.log('\nPour recopier :  node outils/repandre.js --appliquer <projet>');
}
if (retouchees > 0 && !forcer) {
  console.log('Une copie retouchée ne sera pas écrasée sans --meme-si-retouchee.');
}
