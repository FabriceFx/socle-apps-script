#!/usr/bin/env node
// Tableau de bord de tous les projets Apps Script — se lance hors de Google :
//
//     node outils/tableau.js            # contrôles complets, sans les bancs
//     node outils/tableau.js --rapide   # sans le contrôle de types
//     node outils/tableau.js --json
//
// Introduit en v0.13. Une ligne par projet, pour répondre d'un coup d'œil à
// ce qu'on oublie d'un projet à l'autre : du travail non commité ou non
// poussé, une version écrite mais pas publiée, un projet que verifier.js
// refuse, un hook ou une CI absents, des modules du socle qui ont dérivé.
//
// Il ne modifie rien. Comme etat.js, c'est un rapport : la décision reste à
// celui qui connaît le projet.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const P = require('./projets');

const args = process.argv.slice(2);
const rapide = args.includes('--rapide');
const enJson = args.includes('--json');
const profil = P.lireProfil();
const VERSION_SOCLE = fs.readFileSync(path.join(P.RACINE_SOCLE, 'VERSION'), 'utf8').trim();
const dossier = path.resolve(args.find((a) => !a.startsWith('--')) || profil.projets);

const git = (projet, ...arguments_) => {
  const r = spawnSync('git', arguments_, { cwd: projet, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};
const empreinte = (texte) => crypto.createHash('sha256').update(texte.replace(/\r\n/g, '\n').trimEnd()).digest('hex');
const modulesSocle = new Map(fs.readdirSync(path.join(P.RACINE_SOCLE, 'modules'))
  .map((n) => [n, empreinte(fs.readFileSync(path.join(P.RACINE_SOCLE, 'modules', n), 'utf8'))]));
modulesSocle.set('faux-google-socle.js',
  empreinte(fs.readFileSync(path.join(P.RACINE_SOCLE, 'banc', 'faux-google-socle.js'), 'utf8')));

const lignes = P.listerProjets(dossier)
  .filter((projet) => path.resolve(projet) !== path.resolve(P.RACINE_SOCLE))
  .map((projet) => {
    const ligne = { projet: path.basename(projet) };
    ligne.version = P.lireVersion(projet);

    // Git
    if (git(projet, 'rev-parse', '--is-inside-work-tree') !== 'true') {
      ligne.git = 'absent';
    } else {
      const sale = (git(projet, 'status', '--porcelain') || '').split('\n').filter(Boolean).length;
      const ecart = git(projet, 'rev-list', '--left-right', '--count', '@{u}...HEAD');
      const [retard, avance] = ecart ? ecart.split(/\s+/).map(Number) : [null, null];
      const tag = git(projet, 'describe', '--tags', '--abbrev=0');
      Object.assign(ligne, {
        git: 'ok', nonCommites: sale, nonPousses: avance, enRetard: retard, distant: ecart !== null, dernierTag: tag,
      });
    }

    // Garde-fous
    const hook = path.join(projet, '.git', 'hooks', 'pre-commit');
    ligne.hook = fs.existsSync(hook) && fs.readFileSync(hook, 'utf8').includes('socle-apps-script:pre-commit');
    const workflows = path.join(projet, '.github', 'workflows');
    ligne.ci = fs.existsSync(workflows) && fs.readdirSync(workflows)
      .some((f) => /verifier\.yml/.test(fs.readFileSync(path.join(workflows, f), 'utf8')));
    ligne.ciAutre = !ligne.ci && fs.existsSync(workflows);

    // verifier.js
    const v = spawnSync(process.execPath,
      [path.join(__dirname, 'verifier.js'), projet, '--json', '--sans-banc', ...(rapide ? ['--rapide'] : [])],
      { encoding: 'utf8', timeout: 120000 });
    try {
      const rapport = JSON.parse(v.stdout);
      ligne.echecs = rapport.resultats.filter((r) => r.statut === 'echec').map((r) => r.controle);
      ligne.avertissements = rapport.avertissements;
    } catch (e) {
      ligne.echecs = ['verifier illisible'];
    }

    // Copies du socle — même règle que repandre.js : une copie qui déclare une
    // autre version est en retard ; à version égale, une différence est une
    // retouche, et c'est peut-être le projet qui a raison.
    const { source } = P.fichiersPousses(projet);
    const versionDe = (texte) => (/_VERSION_ = '([^']+)'|--socle-version: '([^']+)'|version: '([^']+)'/.exec(texte) || [])
      .slice(1).find(Boolean);
    const copies = [...modulesSocle.keys()].map((nom) => {
      const chemin = nom === 'faux-google-socle.js' ? path.join(projet, 'banc', nom) : path.join(source, nom);
      if (!fs.existsSync(chemin)) return null;
      const texte = fs.readFileSync(chemin, 'utf8');
      if (empreinte(texte) === modulesSocle.get(nom)) return 'a-jour';
      return versionDe(texte) !== VERSION_SOCLE ? 'en-retard' : 'retouche';
    }).filter(Boolean);
    ligne.socle = {
      embarques: copies.length,
      enRetard: copies.filter((c) => c === 'en-retard').length,
      retouches: copies.filter((c) => c === 'retouche').length,
    };
    return ligne;
  });

if (enJson) {
  console.log(JSON.stringify(lignes, null, 2));
  process.exit(0);
}

const couleur = process.stdout.isTTY;
const peindre = (code, texte) => (couleur ? `\x1b[${code}m${texte}\x1b[0m` : texte);
console.log(`Tableau des projets — ${dossier} (socle v${VERSION_SOCLE})\n`);
console.log(`${'projet'.padEnd(28)} ${'version'.padEnd(8)} ${'git'.padEnd(30)} ${'vérif.'.padEnd(22)} hook ci  socle`);
lignes.forEach((l) => {
  let etatGit;
  if (l.git === 'absent') etatGit = peindre('31', 'pas sous Git');
  else {
    const morceaux = [];
    if (l.nonCommites) morceaux.push(`${l.nonCommites} modif.`);
    if (!l.distant) morceaux.push('sans distant');
    else if (l.nonPousses) morceaux.push(`${l.nonPousses} à pousser`);
    if (l.version && l.dernierTag !== `v${l.version}`) morceaux.push(l.dernierTag ? 'non publiée' : 'jamais taguée');
    etatGit = morceaux.length ? peindre('33', morceaux.join(', ')) : peindre('32', 'à jour');
  }
  const verif = l.echecs.length ? peindre('31', `✗ ${l.echecs.join(', ')}`)
    : (l.avertissements ? peindre('33', `! ${l.avertissements} avert.`) : peindre('32', '✓'));
  const morceauxSocle = [];
  if (l.socle.retouches) morceauxSocle.push(peindre('31', `${l.socle.retouches} retouché(s)`));
  if (l.socle.enRetard) morceauxSocle.push(peindre('33', `${l.socle.enRetard} en retard`));
  const socle = l.socle.embarques === 0 ? '·'
    : (morceauxSocle.length ? `${morceauxSocle.join(', ')} /${l.socle.embarques}` : peindre('32', `${l.socle.embarques} à jour`));
  const visible = (t) => t.replace(/\x1b\[[0-9;]*m/g, '');   // eslint-disable-line no-control-regex
  const pad = (t, n) => t + ' '.repeat(Math.max(0, n - visible(t).length));
  console.log(`${l.projet.padEnd(28)} ${(l.version || '—').padEnd(8)} ${pad(etatGit, 30)} ${pad(verif, 22)} ${l.hook ? ' ✓  ' : ' ·  '} ${l.ci ? '✓ ' : (l.ciAutre ? '~ ' : '· ')}  ${socle}`);
});
console.log(`\n${lignes.length} projets. « non publiée » : VERSION n’a pas de tag (publier.js). `
  + '« ~ » en CI : une CI qui n’appelle pas verifier.yml. Détail d’un projet : node outils/verifier.js <projet>.');
