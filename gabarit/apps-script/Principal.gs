/**
 * {{TITRE}} — points d'entrée. Introduit en v0.1.
 *
 * Seules les fonctions déclarées par « function » sont des points d'entrée :
 * l'éditeur ne propose qu'elles au menu d'exécution, et Apps Script ne trouve
 * qu'elles quand un menu ou un déclencheur les désigne par leur nom. Tout
 * l'interne s'écrit « const nom_ = () => … » et reste invisible.
 */

const {{CONSTANTE}}_VERSION_ = '0.1.0';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('{{TITRE}}')
    .addItem('À propos', 'aProposDe{{PREFIXE}}')
    .addToUi();
}

function aProposDe{{PREFIXE}}() {
  const ui = SpreadsheetApp.getUi();
  ui.alert('{{TITRE}}', texteAPropos{{PREFIXE}}_(), ui.ButtonSet.OK);
}

// La version se montre là où l'on se demande ce qui tourne : un déploiement
// sert une copie figée du code, et ce numéro est le seul moyen de le savoir.
const texteAPropos{{PREFIXE}}_ = () => [
  `Version ${{{CONSTANTE}}_VERSION_}`,
  '',
  '{{AUTEUR}}',
].join('\n');
