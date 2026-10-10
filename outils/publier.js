#!/usr/bin/env node
// Publie une version d'un projet Apps Script — en deux temps, comme toute
// opération qui touche la production :
//
//     node outils/publier.js [projet] patch|minor|major|x.y.z              # le plan, rien ne bouge
//     node outils/publier.js [projet] patch|minor|major|x.y.z --appliquer  # l'exécute
//
//     --deploiement <id>   le déploiement à faire avancer, s'il y en a plusieurs
//     --sans-clasp         version, journal et tag seulement
//
// Introduit en v0.13. Il existe pour une raison précise : **un déploiement
// sert une copie figée du code**. `clasp push` ne change rien à ce que sert
// l'URL /exec ; il faut une version Apps Script, puis faire avancer le
// déploiement dessus. Oublier la seconde étape donne « Fonction de script
// introuvable » sur une fonction qui existe bel et bien. Ici, les étapes
// s'enchaînent, et le numéro semver devient la description de la version
// Apps Script : `clasp list-deployments` répond alors à « qu'est-ce qui
// tourne ? ».
//
// Ce qu'il refuse de faire :
//   - **inventer le journal.** Sans entrée « ## [Non publié] » ni
//     « ## [x.y.z] » dans CHANGELOG.md, il s'arrête : ce qui change et pour
//     qui, c'est à un humain de l'écrire ;
//   - publier un arbre Git sale, ou un projet que verifier.js refuse ;
//   - pousser vers GitHub : `git push` reste une décision à part.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('./projets');

const args = process.argv.slice(2);
const appliquer = args.includes('--appliquer');
const sansClasp = args.includes('--sans-clasp');
const iDeploiement = args.indexOf('--deploiement');
const deploiementDemande = iDeploiement === -1 ? null : args[iDeploiement + 1];
const positionnels = args.filter((a, i) => !a.startsWith('--') && (iDeploiement === -1 || i !== iDeploiement + 1));
const NIVEAUX = ['patch', 'minor', 'major'];
const niveau = positionnels.find((a) => NIVEAUX.includes(a) || /^\d+\.\d+\.\d+$/.test(a));
const depart = positionnels.find((a) => a !== niveau) || process.cwd();

const arreter = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

if (!niveau) arreter('Préciser patch, minor, major, ou un numéro x.y.z.');
const projet = P.racineProjet(depart);
if (!projet) arreter(`Aucun projet Apps Script dans ${path.resolve(depart)}.`);

const COMPTE_CLASP = P.argumentsClasp((() => { try { return P.lireProfil(); } catch (e) { return {}; } })());
const lancer = (commande, arguments_, options = {}) => spawnSync(commande,
  commande === 'clasp' ? [...COMPTE_CLASP, ...arguments_] : arguments_, { cwd: projet, encoding: 'utf8', ...options });

// --- Ce qu'on publie ---------------------------------------------------------

const actuelle = P.lireVersion(projet);
if (!actuelle) arreter('Pas de fichier VERSION : rien à incrémenter. Le créer (0.1.0), puis relancer.');
const nouvelle = (() => {
  if (!NIVEAUX.includes(niveau)) return niveau;
  const [ma, mi, pa] = actuelle.split('-')[0].split('.').map(Number);
  if (niveau === 'major') return `${ma + 1}.0.0`;
  if (niveau === 'minor') return `${ma}.${mi + 1}.0`;
  return `${ma}.${mi}.${pa + 1}`;
})();
const aujourdHui = new Date().toLocaleDateString('sv-SE');   // yyyy-MM-dd, dans le fuseau local

const plan = [];
const bloquants = [];
const avertissements = [];

// Git : un arbre propre, pour que le commit de version ne contienne qu'elle.
const estGit = lancer('git', ['rev-parse', '--is-inside-work-tree']).status === 0;
if (!estGit) {
  bloquants.push('Le projet n’est pas sous Git : impossible de marquer la version d’un tag. git init, puis relancer.');
} else {
  const sale = lancer('git', ['status', '--porcelain']).stdout.trim();
  if (sale) bloquants.push(`Arbre Git non propre — commiter ou remiser d’abord :\n${sale.split('\n').map((l) => `      ${l}`).join('\n')}`);
  if (lancer('git', ['rev-parse', '-q', '--verify', `refs/tags/v${nouvelle}`]).status === 0) {
    bloquants.push(`Le tag v${nouvelle} existe déjà.`);
  }
}

// Le journal : on le date, on ne l'écrit pas.
const cheminJournal = path.join(projet, 'CHANGELOG.md');
const journal = fs.existsSync(cheminJournal) ? fs.readFileSync(cheminJournal, 'utf8') : null;
const enteteNonPublie = /^## \[(?:Non publié|Unreleased)\][^\n]*$/m;
const enteteNouvelle = new RegExp(`^## \\[${nouvelle.replace(/\./g, '\\.')}\\]`, 'm');
let nouveauJournal = journal;
if (!journal) {
  bloquants.push('Pas de CHANGELOG.md.');
} else if (enteteNouvelle.test(journal)) {
  plan.push(`CHANGELOG.md : l’entrée [${nouvelle}] existe déjà, elle est gardée telle quelle`);
} else if (enteteNonPublie.test(journal)) {
  nouveauJournal = journal.replace(enteteNonPublie, `## [${nouvelle}] - ${aujourdHui}`);
  plan.push(`CHANGELOG.md : « ## [Non publié] » devient « ## [${nouvelle}] - ${aujourdHui} »`);
} else {
  bloquants.push(`CHANGELOG.md n’a ni « ## [Non publié] » ni « ## [${nouvelle}] ». `
    + 'Écrire ce qui change, et pour qui — ce n’est pas à un outil de l’inventer.');
}

// Les constantes : celles qui valent la version actuelle et ne sont pas
// celles d'un module embarqué.
const { source, fichiers } = P.fichiersPousses(projet);
const constantes = P.constantesDeVersion(source, fichiers).filter((c) => !c.module && c.valeur === actuelle);
plan.push(`VERSION : ${actuelle} → ${nouvelle}`);
if (constantes.length) {
  constantes.forEach((c) => plan.push(`${c.fichier}:${c.ligne} : ${c.nom} = '${nouvelle}'`));
} else {
  avertissements.push('Aucune constante de version dans le code : la version publiée ne sera visible nulle part dans l’outil.');
}

// clasp : pousser, figer une version, faire avancer le déploiement.
const aClasp = !sansClasp && fs.existsSync(path.join(projet, '.clasp.json'));
let deploiements = null;
if (!sansClasp && !aClasp) {
  avertissements.push('Pas de .clasp.json : rien ne sera poussé chez Google (--sans-clasp implicite).');
}
if (aClasp) {
  const liste = lancer('clasp', ['--json', 'list-deployments']);
  if (liste.status !== 0) {
    bloquants.push(`clasp list-deployments échoue : ${(liste.stderr || liste.stdout).trim().split('\n')[0]} `
      + '— vérifier la connexion (clasp show-authorized-user).');
  } else {
    deploiements = JSON.parse(liste.stdout).filter((d) => d.versionNumber);
  }
}
let cible = null;
if (aClasp && deploiements) {
  plan.push('clasp push --force');
  plan.push(`clasp create-version "v${nouvelle}"`);
  if (deploiementDemande) {
    cible = deploiements.find((d) => d.deploymentId === deploiementDemande);
    if (!cible) bloquants.push(`Déploiement ${deploiementDemande} introuvable parmi les déploiements figés.`);
  } else if (deploiements.length === 1) {
    [cible] = deploiements;
  } else if (deploiements.length > 1) {
    bloquants.push(`${deploiements.length} déploiements figés — préciser lequel avec --deploiement <id> :\n${
      deploiements.map((d) => `      ${d.deploymentId}  @${d.versionNumber}  ${d.description || ''}`).join('\n')}`);
  } else {
    plan.push('aucun déploiement figé : la version est créée, rien ne la sert (projet lié au classeur ou bibliothèque)');
  }
  if (cible) {
    plan.push(`clasp update-deployment ${cible.deploymentId} — de @${cible.versionNumber} (${cible.description || 'sans description'}) vers la nouvelle version`);
  }
}
if (estGit) plan.push(`git commit « Version ${nouvelle} » et tag v${nouvelle} (pas de git push)`);

// verifier.js : on ne publie pas ce qu'on ne pousserait pas.
const verification = spawnSync(process.execPath, [path.join(__dirname, 'verifier.js'), projet, '--json'], { encoding: 'utf8' });
let rapport = null;
try { rapport = JSON.parse(verification.stdout); } catch (e) { rapport = null; }
if (!rapport) {
  bloquants.push(`verifier.js n’a pas pu s’exécuter : ${(verification.stderr || '').trim().split('\n')[0]}`);
} else {
  // Le contrôle de version échouera tant que la constante n'est pas montée :
  // il est refait après l'application, pas ici.
  const echecs = rapport.resultats.filter((r) => r.statut === 'echec' && r.controle !== 'version');
  if (echecs.length) {
    bloquants.push(`verifier.js refuse le projet : ${echecs.map((r) => `${r.controle} (${r.resume})`).join(', ')}. `
      + `Le lancer seul pour le détail : node ${path.relative(projet, path.join(__dirname, 'verifier.js'))}`);
  }
}

// --- Le plan -----------------------------------------------------------------

console.log(`publier — ${path.basename(projet)} : ${actuelle} → ${nouvelle}`);
plan.forEach((p) => console.log(`  · ${p}`));
avertissements.forEach((a) => console.log(`  ! ${a}`));
if (bloquants.length) {
  bloquants.forEach((b) => console.log(`  ✗ ${b}`));
  process.exit(1);
}
if (!appliquer) {
  console.log('\nRien n’a bougé. Relire le plan, puis relancer avec --appliquer.');
  process.exit(0);
}

// --- L'application -----------------------------------------------------------
//
// Chaque étape est dite **au moment où elle aboutit**. Une interruption
// laisse donc une trace exacte de ce qui reste à faire, plutôt qu'un état
// qu'il faudrait deviner.

const etape = (quoi, faire) => {
  const resultat = faire();
  if (resultat && resultat.status !== undefined && resultat.status !== 0) {
    console.error(`  ✗ ${quoi}\n${(resultat.stderr || resultat.stdout || '').trim()}`);
    console.error('\nArrêt. Ce qui précède est fait ; reprendre à la main à partir de cette étape.');
    process.exit(1);
  }
  console.log(`  ✓ ${quoi}`);
  return resultat;
};

console.log('');
etape('fichiers mis à jour', () => {
  fs.writeFileSync(path.join(projet, 'VERSION'), `${nouvelle}\n`);
  if (nouveauJournal !== journal) fs.writeFileSync(cheminJournal, nouveauJournal);
  constantes.forEach((c) => {
    const chemin = path.join(source, c.fichier);
    const texte = fs.readFileSync(chemin, 'utf8');
    const motif = new RegExp(`(\\b${c.nom}\\s*=\\s*['"])${actuelle.replace(/\./g, '\\.')}(['"])`);
    fs.writeFileSync(chemin, texte.replace(motif, `$1${nouvelle}$2`));
  });
});
etape('verifier.js accepte la nouvelle version', () => spawnSync(process.execPath,
  [path.join(__dirname, 'verifier.js'), projet, '--sans-banc'], { encoding: 'utf8' }));
if (estGit) {
  etape(`commit « Version ${nouvelle} »`, () => {
    const ajout = lancer('git', ['add', '-A']);
    if (ajout.status !== 0) return ajout;
    return lancer('git', ['commit', '-q', '-m', `Version ${nouvelle}`]);
  });
  etape(`tag v${nouvelle}`, () => lancer('git', ['tag', `v${nouvelle}`]));
}
if (aClasp) {
  etape('clasp push', () => lancer('clasp', ['push', '--force']));
  const creation = etape(`version Apps Script « v${nouvelle} »`, () => lancer('clasp', ['--json', 'create-version', `v${nouvelle}`]));
  const numero = (() => {
    try { return JSON.parse(creation.stdout).versionNumber; } catch (e) { return null; }
  })();
  if (cible && numero) {
    etape(`déploiement ${cible.deploymentId.slice(0, 12)}… → @${numero}`, () => lancer('clasp',
      ['update-deployment', cible.deploymentId, '--versionNumber', String(numero), '--description', `v${nouvelle}`]));
  } else if (cible) {
    console.error('  ! numéro de version Apps Script illisible : faire avancer le déploiement à la main.');
  }
}
console.log(`\nVersion ${nouvelle} publiée.${estGit ? ' Pour GitHub : git push && git push --tags' : ''}`);
