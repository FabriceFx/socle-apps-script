#!/usr/bin/env node
// Pose le hook Git `pre-commit` qui lance verifier.js — se lance hors de
// Google :
//
//     node outils/equiper.js <projet>        # un projet
//     node outils/equiper.js toutes          # tous ceux du dossier des projets
//     node outils/equiper.js toutes --retirer
//
// Introduit en v0.13. Le hook Claude Code garde `clasp push` ; celui-ci garde
// les commits, y compris ceux qu'on fait soi-même dans un terminal. Les deux
// appellent le même verifier.js, de sorte qu'un contrôle ajouté au socle
// protège tout le monde à la fois.
//
// Le hook ne contient pas le contrôle, seulement le chemin pour le trouver :
// le profil d'abord, puis un socle voisin du projet. Ainsi, mettre le socle à
// jour suffit — on ne repasse pas dans chaque projet.
//
// **Il n'écrase jamais un hook qu'il n'a pas posé** (husky, pre-commit, un
// script maison). Il le signale et s'arrête là : c'est à son auteur de
// décider s'il appelle verifier.js depuis le sien.

const fs = require('fs');
const path = require('path');
const P = require('./projets');

const MARQUE = 'socle-apps-script:pre-commit';

const HOOK = `#!/bin/sh
# ${MARQUE}
# Posé par socle-apps-script/outils/equiper.js — ne pas modifier à la main :
# relancer equiper.js. Pour passer outre une fois : git commit --no-verify.

PROFIL="\${ATELIER_PROFIL:-$HOME/.config/atelier-apps-script/profil.json}"
SOCLE="\${SOCLE_APPS_SCRIPT:-}"
if [ -z "$SOCLE" ] && [ -f "$PROFIL" ]; then
  SOCLE=$(node -e 'const p=require(process.argv[1]);process.stdout.write((p.socle||"").replace(/^~/,require("os").homedir()))' "$PROFIL" 2>/dev/null)
fi
RACINE=$(git rev-parse --show-toplevel)
[ -z "$SOCLE" ] && SOCLE="$(dirname "$RACINE")/socle-apps-script"

if [ ! -f "$SOCLE/outils/verifier.js" ]; then
  echo "pre-commit : socle introuvable ($SOCLE)."
  echo "→ Lancer installer.sh de l'atelier, ou exporter SOCLE_APPS_SCRIPT=<chemin du socle>."
  exit 1
fi

node "$SOCLE/outils/verifier.js" "$RACINE" --sans-banc || {
  echo ""
  echo "Commit refusé par verifier.js (le banc ne tourne pas ici : il tourne avant clasp push et en CI)."
  exit 1
}

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git --pre-commit --staged --no-banner --redact "$RACINE" || {
    echo "Commit refusé : gitleaks a trouvé un secret dans ce qui est indexé."
    exit 1
  }
fi
`;

const args = process.argv.slice(2);
const retirer = args.includes('--retirer');
const cible = args.find((a) => !a.startsWith('--'));
if (!cible) {
  console.error('Préciser un projet, ou « toutes ».');
  process.exit(2);
}

const profil = P.lireProfil();
const projets = cible === 'toutes'
  ? P.listerProjets(profil.projets)
  : [P.racineProjet(cible)].filter(Boolean);

let poses = 0;
projets.forEach((projet) => {
  const nom = path.basename(projet);
  const git = path.join(projet, '.git');
  if (!fs.existsSync(git) || !fs.statSync(git).isDirectory()) {
    console.log(`  · ${nom.padEnd(28)} pas sous Git — rien à poser`);
    return;
  }
  const chemin = path.join(git, 'hooks', 'pre-commit');
  const existant = fs.existsSync(chemin) ? fs.readFileSync(chemin, 'utf8') : null;
  const estLeNotre = existant !== null && existant.includes(MARQUE);

  if (retirer) {
    if (estLeNotre) {
      fs.unlinkSync(chemin);
      console.log(`  ✓ ${nom.padEnd(28)} hook retiré`);
    }
    return;
  }
  if (existant !== null && !estLeNotre) {
    console.log(`  ! ${nom.padEnd(28)} un pre-commit d’une autre origine existe — laissé tel quel`);
    return;
  }
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  fs.writeFileSync(chemin, HOOK, { mode: 0o755 });
  poses += 1;
  console.log(`  ✓ ${nom.padEnd(28)} ${estLeNotre ? 'hook mis à jour' : 'hook posé'}`);
});
if (!retirer) console.log(`\n${poses} hook(s) pre-commit en place.`);
