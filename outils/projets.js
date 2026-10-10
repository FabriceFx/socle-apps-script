// Ce que les outils du socle ont besoin de savoir d'un projet, écrit une fois.
//
// Introduit en v0.13. Avant, chaque outil retrouvait seul ses fichiers, et
// `etat.js` comme `repandre.js` les prenaient dans l'ordre du système de
// fichiers. Or l'ordre compte : Apps Script exécute le code de premier niveau
// fichier par fichier, **dans l'ordre où clasp les a poussés** — l'ordre
// alphabétique, sauf `filePushOrder`. Une constante lue dans `Decision.gs` et
// déclarée dans `Langues.gs` lève au chargement, et toutes les fonctions du
// projet deviennent introuvables. Un banc qui charge les fichiers dans un ordre
// choisi à la main ne le voit pas.

const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE_SOCLE = path.join(__dirname, '..');

const developper = (chemin) => (typeof chemin === 'string' && chemin.startsWith('~')
  ? path.join(os.homedir(), chemin.slice(1))
  : chemin);

// Le profil dit **pour qui** l'on travaille : auteur, licence, compte GitHub,
// dossier des projets. Il vit hors des dépôts parce qu'il change d'une machine
// à l'autre — chez soi, chez un employeur — alors que le code, lui, ne change
// pas. Sans profil, les outils fonctionnent encore ; seul `nouveau-projet`
// refuse, faute de savoir à qui attribuer le code.
const CHEMIN_PROFIL = developper(process.env.ATELIER_PROFIL
  || '~/.config/atelier-apps-script/profil.json');

const lireProfil = () => {
  let brut = {};
  if (fs.existsSync(CHEMIN_PROFIL)) {
    try {
      brut = JSON.parse(fs.readFileSync(CHEMIN_PROFIL, 'utf8'));
    } catch (erreur) {
      throw new Error(`Profil illisible (${CHEMIN_PROFIL}) : ${erreur.message}. `
        + 'Corriger le JSON, ou le supprimer et relancer installer.sh.');
    }
  }
  return {
    ...brut,
    existe: fs.existsSync(CHEMIN_PROFIL),
    chemin: CHEMIN_PROFIL,
    socle: developper(brut.socle) || RACINE_SOCLE,
    projets: developper(brut.projets) || path.resolve(RACINE_SOCLE, '..'),
  };
};

/**
 * Le dossier qui porte `appsscript.json`, c'est-à-dire ce que clasp pousse.
 *
 * On ne lit pas `.clasp.json` d'abord : il est ignoré par Git, donc absent d'un
 * clone frais et de la CI. `appsscript.json`, lui, est versionné.
 */
const dossierSource = (projet) => {
  const candidats = [projet, path.join(projet, 'apps-script')];
  const trouve = candidats.find((d) => fs.existsSync(path.join(d, 'appsscript.json')));
  if (trouve) return trouve;
  const clasp = path.join(projet, '.clasp.json');
  if (fs.existsSync(clasp)) {
    const { rootDir } = JSON.parse(fs.readFileSync(clasp, 'utf8'));
    if (rootDir && fs.existsSync(path.join(projet, rootDir, 'appsscript.json'))) {
      return path.join(projet, rootDir);
    }
  }
  return null;
};

// Motifs `.claspignore` : clasp les passe à micromatch, sans `matchBase`. Un
// motif sans barre ne vise donc que la racine — `*.gs` n'attrape pas
// `outils/x.gs`. Le dernier motif qui correspond l'emporte, et `!` réautorise.
const motifEnRegex = (motif) => {
  let re = '';
  for (let i = 0; i < motif.length; i += 1) {
    const c = motif[i];
    if (c === '*' && motif[i + 1] === '*') {
      const suivi = motif[i + 2] === '/';
      re += suivi ? '(?:.*/)?' : '.*';
      i += suivi ? 2 : 1;
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
};

const lireClaspignore = (projet) => {
  const fichier = path.join(projet, '.claspignore');
  if (!fs.existsSync(fichier)) return null;
  return fs.readFileSync(fichier, 'utf8').split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => ({ negation: l.startsWith('!'), re: motifEnRegex(l.replace(/^!/, '')) }));
};

const estIgnore = (relatif, motifs) => {
  if (!motifs) return false;
  let ignore = false;
  motifs.forEach(({ negation, re }) => {
    if (re.test(relatif)) ignore = !negation;
  });
  return ignore;
};

const DOSSIERS_JAMAIS_POUSSES = new Set(['node_modules', 'banc', 'tests', 'essai', 'scratch']);

/**
 * Les `.gs` que clasp pousserait, **dans l'ordre où il les pousse**.
 *
 * Ordre relevé dans les sources de clasp 3 (`core/files.js`) : d'abord ceux de
 * `filePushOrder`, dans cet ordre, puis les autres par `localeCompare`.
 */
const fichiersPousses = (projet) => {
  const source = dossierSource(projet);
  if (!source) return { source: null, fichiers: [] };
  const motifs = lireClaspignore(projet);
  const trouves = [];
  const parcourir = (dossier) => {
    fs.readdirSync(dossier, { withFileTypes: true }).forEach((e) => {
      if (e.name.startsWith('.')) return;
      const complet = path.join(dossier, e.name);
      if (e.isDirectory()) {
        if (!DOSSIERS_JAMAIS_POUSSES.has(e.name)) parcourir(complet);
        return;
      }
      if (!e.name.endsWith('.gs')) return;
      const relatif = path.relative(source, complet).split(path.sep).join('/');
      if (!estIgnore(relatif, motifs)) trouves.push(relatif);
    });
  };
  parcourir(source);

  let ordre = [];
  const clasp = path.join(projet, '.clasp.json');
  if (fs.existsSync(clasp)) {
    ordre = (JSON.parse(fs.readFileSync(clasp, 'utf8')).filePushOrder || [])
      .map((p) => path.normalize(p));
  }
  const rang = (f) => {
    const i = ordre.findIndex((o) => path.normalize(path.join(source, f)).endsWith(o));
    return i === -1 ? Infinity : i;
  };
  trouves.sort((a, b) => {
    const ra = rang(a);
    const rb = rang(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
  return { source, fichiers: trouves };
};

/**
 * La racine du projet qui contient `depart` : le premier dossier, en
 * remontant, qui porte un marqueur de projet et un `appsscript.json`.
 *
 * On remonte parce qu'on est souvent lancé depuis `apps-script/`, qui porte
 * le manifeste mais ni `VERSION` ni `.git` : s'arrêter là ferait conclure
 * « aucune version » sur un projet qui en a une.
 */
const MARQUEURS = ['.clasp.json', 'VERSION', '.git'];
const racineProjet = (depart) => {
  let dossier = path.resolve(depart);
  for (;;) {
    const marque = MARQUEURS.some((m) => fs.existsSync(path.join(dossier, m)));
    if (marque && dossierSource(dossier)) return dossier;
    const parent = path.dirname(dossier);
    if (parent === dossier) break;
    dossier = parent;
  }
  return dossierSource(depart) ? path.resolve(depart) : null;
};

/** Tous les dossiers d'un répertoire qui contiennent un projet Apps Script. */
const listerProjets = (dossierProjets) => fs.readdirSync(dossierProjets, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  .map((e) => path.join(dossierProjets, e.name))
  .filter((d) => dossierSource(d) !== null);

// Un profil peut nommer un compte clasp (clasp login --user <nom>) : chez soi
// et chez un employeur sur la même machine, publier avec le mauvais compte
// enverrait le code dans le mauvais domaine Google.
const argumentsClasp = (profil) => (profil && profil.compteClasp && profil.compteClasp !== 'default'
  ? ['--user', profil.compteClasp] : []);

/** Version déclarée par le fichier VERSION, ou null. */
const lireVersion = (projet) => {
  const fichier = path.join(projet, 'VERSION');
  return fs.existsSync(fichier) ? fs.readFileSync(fichier, 'utf8').trim() : null;
};

// Une constante `…VERSION…` porte soit la version du projet, soit celle d'un
// module embarqué : `SOCLE_DATES_VERSION_` dit la version du socle d'où vient
// la copie, pas celle du projet. Elles ne se confondent pas.
const MOTIF_CONSTANTE_VERSION = /^[ \t]*(?:const|var|let)\s+([A-Za-z0-9_]*VERSION[A-Za-z0-9_]*)\s*=\s*['"](\d+\.\d+\.\d+[^'"]*)['"]/gm;

const constantesDeVersion = (source, fichiers) => {
  const trouvees = [];
  fichiers.forEach((f) => {
    const texte = fs.readFileSync(path.join(source, f), 'utf8');
    for (const m of texte.matchAll(MOTIF_CONSTANTE_VERSION)) {
      trouvees.push({
        fichier: f,
        nom: m[1],
        valeur: m[2],
        module: m[1].startsWith('SOCLE_'),
        ligne: texte.slice(0, m.index).split('\n').length,
      });
    }
  });
  return trouvees;
};

module.exports = {
  RACINE_SOCLE,
  CHEMIN_PROFIL,
  developper,
  lireProfil,
  dossierSource,
  racineProjet,
  fichiersPousses,
  listerProjets,
  lireVersion,
  argumentsClasp,
  constantesDeVersion,
  motifEnRegex,
  estIgnore,
};
