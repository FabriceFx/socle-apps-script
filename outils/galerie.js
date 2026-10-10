// Assemble la galerie des composants — se lance hors de Google :
//
//     node outils/galerie.js [dossier de sortie]
//
// La feuille de style n'est jamais recopiée : elle est lue à la source et
// injectée. Une galerie qui porterait sa propre copie du CSS montrerait, au
// bout de quelques semaines, autre chose que ce que les projets utilisent.

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const style = fs.readFileSync(path.join(RACINE, 'modules', 'SocleStyle.html'), 'utf8');
const corps = fs.readFileSync(path.join(__dirname, 'galerie.html'), 'utf8');
const version = fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim();

const page = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Socle ${version} — galerie des composants</title>
${style}
</head>
<body style="margin:0">
${corps}
</body>
</html>
`;

const sortie = path.join(process.argv[2] || RACINE, 'galerie-rendue.html');
fs.writeFileSync(sortie, page, 'utf8');
console.log(`Galerie écrite : ${sortie}`);
console.log(`  socle version ${version}, ${(style.match(/^\.s-/gm) || []).length} règles de classe`);
