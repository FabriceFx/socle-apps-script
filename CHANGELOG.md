# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Ce projet suit le [Semantic Versioning](https://semver.org/lang/fr/).

## [0.13.0] - 2026-10-10

### Ajouté

- **`outils/verifier.js`** — les contrôles qu'on oubliait avant `clasp push`,
  rassemblés et appelés par le hook Git, le hook Claude Code et la CI. Il lit
  les fichiers **dans l'ordre où clasp les pousse** (alphabétique, relevé dans
  les sources de clasp 3) et cherche ce qui ne casse qu'en production :
  syntaxe du projet entier, `function` déclarée deux fois, constante lue avant
  sa déclaration, cible de menu ou de `google.script.run` introuvable, service
  avancé employé sans être activé, énumération inventée. Sa première mesure, sur
  dix-neuf projets, a trouvé trois défauts de production qu'aucun banc n'avait
  vus.
- **Contrôle de types** par TypeScript et `@types/google-apps-script`, avec un
  cliquet (`--accepter`, `verifier.json`) pour que seuls les signalements
  nouveaux échouent. Les types en retard sur Google se corrigent dans
  `CORRECTIFS_TYPES`, page citée — le premier : `DriveApp.Permission.FILE_ORGANIZER`.
- **`outils/publier.js`** — version, journal daté, tag, `clasp push`, version
  Apps Script et déploiement, en deux temps : le plan, puis `--appliquer`. Il
  refuse d'inventer le journal.
- **`outils/nouveau-projet.js` et `gabarit/`** — un projet aux conventions,
  attribué selon le **profil** (`~/.config/atelier-apps-script/profil.json`),
  pour que le même socle serve chez soi et chez un employeur.
- **`outils/tableau.js`** — une ligne par projet : Git, publication,
  vérification, hook, CI, copies du socle.
- **`outils/equiper.js`** — le hook Git `pre-commit`, qui n'écrase jamais un
  hook qu'il n'a pas posé.
- **`banc/faux-google-socle.js`** — le cœur commun des services simulés, avec
  `chargerProjet` qui charge dans l'ordre de clasp. Suivi par `etat.js` et
  `repandre.js` comme un module.
- **`banc/outils.test.js`** — chaque défaut que les outils prétendent attraper
  y est réintroduit ; éprouvé en désactivant deux protections, qu'il a vues.
- **CI** : `.github/workflows/verifier.yml`, réutilisable par les projets, et
  `ci.yml` pour le socle. Aucun déploiement depuis la CI.
- `package.json` (TypeScript 5.9.3, `@types/google-apps-script` 2.0.13,
  épinglés) et `.node-version` (24).

### Modifié

- Le socle est désormais sous Git ; `v0.12.2` marque l'état d'avant.
- Tous les modules passent en 0.13.0 sans changer de comportement : un seul
  numéro de version pour tout le socle.

## [0.12.2] - 2026-09-25

### Corrigé

- `SocleFeuilles.retirerFeuilleParDefaut` ne reconnaissait pas « Feuil1 » ni « Feuil 1 », nom par défaut d'Excel en français, que porte un classeur `.xlsx` importé dans Sheets. Trouvé en installant `metrique-usage`.

## [0.12.1] - 2026-09-12

### Corrigé

- **Les liens n'étaient pas stylés du tout.** Tout `<a>` retombait donc sur les
  couleurs par défaut du navigateur — `#0000EE` et `#551A8B` —, choisies pour
  aucun de nos deux fonds. Sur fond sombre, un lien déjà visité devenait un
  bordeaux quasi illisible : constaté sur l'application web de l'assistant des
  procédures, où la liste « Documents lus » disparaissait à mesure qu'on la
  consultait. Deux jetons, `--s-lien` et `--s-lien-visite`, dans les deux
  thèmes, plus un anneau de focus au clavier.
- **Le fond n'était peint que sur `.s-page`.** Une page centrée en largeur
  limitée — `max-width` avec `margin: 0 auto` — laissait paraître le blanc du
  navigateur de part et d'autre du panneau sombre. Le fond se peint désormais
  sur `html, body`, et `.s-page` prend `min-height: 100%`.

  Ces deux défauts ont la même racine : **une propriété jamais déclarée ne
  laisse pas de trace, contrairement à un jeton inconnu.** Le banc vérifiait que
  tout `var(--x)` est défini ; il vérifie maintenant aussi que les liens et le
  fond du document sont bien déclarés quelque part.

## [0.12.0] - 2026-09-12

### Corrigé — dans le banc, et c'est le plus grave

- **Une section entière du banc ne s'exécutait plus, en silence.** La section
  asynchrone ajoutée en 0.4 se terminait par un `return Promise.all(...)` au
  niveau du module : en CommonJS le module est une fonction, donc ce `return`
  **sortait du module** et sautait tout ce qui suivait. Les contrôles de la
  feuille de style — jetons, thème sombre, noms français, cohérence avec la
  galerie — n'avaient plus tourné depuis plusieurs versions, et le banc
  annonçait « 0 échec » en toute bonne foi. Un banc qui se déclare vert en
  ayant sauté un quart de son travail est pire qu'un banc rouge.
- **Garde-fou** : chaque section s'enregistre en démarrant, et la conclusion
  vérifie qu'aucune de la liste attendue n'a été sautée. Les promesses des
  sections asynchrones sont attendues avant de conclure, jamais retournées.

### Ajouté

- **`s-clair`** — fige la palette claire sur un sous-arbre, quel que soit le
  réglage du système. Indispensable dans une barre latérale ou une boîte de
  dialogue Apps Script : leur cadre appartient à Sheets, qui ne suit pas
  `prefers-color-scheme`. Un panneau sombre dans un bandeau clair ne se lit pas
  comme un thème, il se lit comme un défaut.
- **`s-page--etroite`** — trois cents pixels de barre latérale ne se gaspillent
  pas : fond de page retiré (le cadre est déjà fourni), espacement resserré,
  boutons sur toute la largeur.

## [0.11.0] - 2026-09-12

### Ajouté

- **`listeSurReglage`, `nombreSurReglage`, `listeSurColonne`** — poser une
  liste déroulante ou un intervalle sur un réglage, **trouvé par sa clé**.
  Jamais par numéro de ligne : une ligne insérée à la main déplacerait la
  validation sur le mauvais réglage, et l'on ne s'en apercevrait qu'après
  avoir fait choisir une mauvaise valeur à quelqu'un. Sept validations
  existaient dans deux projets, écrites à la main.
- **Le défaut ne bloque pas.** Pour un ensemble fermé — Oui / Non — bloquer
  une saisie hors liste est juste, et `{ bloquant: true }` le fait. Pour une
  liste tirée d'une API — les modèles disponibles — la liste peut dater, et un
  nom valide apparu depuis ne doit pas être refusé : on avertit sans bloquer.
- Le faux service du banc bâtit désormais de vraies règles de validation, et
  **refuse une liste vide** comme le vrai — sans quoi il aurait laissé poser
  une liste déroulante sans rien dedans.

## [0.10.0] - 2026-09-12

### Ajouté

- **`SocleFeuilles.retirerFeuilleParDefaut()`** — la feuille vide que Google
  pose dans un classeur neuf, et qui restait en travers après l'installation.
  `nettoyerFeuilleParDefaut_` existait déjà dans deux projets sous deux formes ;
  la mesure des noms répétés l'avait signalé et je ne l'avais pas vu.
- **Le nom n'est pas la garde.** La liste de noms (`feuille|sheet|hoja|blatt|
  foglio|folha` suivi de 1, casse et espace libres) n'a pas à être exhaustive :
  ce qui protège, c'est que la feuille soit **vide** et qu'il en reste une
  autre. Un nom oublié laisse un onglet vide de trop, sans conséquence ; une
  suppression de trop perdrait du travail. Le défaut penche du bon côté.
- Le faux classeur du banc refuse désormais de supprimer la dernière feuille,
  comme le vrai. Les deux gardes, retirées, font échouer le banc.

## [0.9.2] - 2026-09-12

Deux défauts trouvés en portant l'**assistant des procédures**, pas au banc du
socle. Le premier est sérieux.

### Corrigé

- **`SocleDates` lisait une chaîne ISO en UTC comme une heure locale.**
  `2026-09-01T10:00:00.000Z` devenait `10:00` au lieu de `12:00`. Or les API
  Google — Drive, Agenda, Meet — horodatent toutes en UTC : **toute date lue
  près de minuit changeait de jour**, dans une colonne faite pour être triée.
  Une chaîne portant un fuseau explicite (`Z` ou `±hh:mm`) est désormais
  analysée telle quelle, sans ambiguïté ; une chaîne qui n'en porte pas reste
  lue en heure locale, parce que c'est ce que Sheets rend d'une cellule.
- **`repandre.js` confondait « copie d'une version antérieure » et « copie
  retouchée ».** Il refusait donc toute mise à jour touchant au code —
  c'est-à-dire toutes celles qui comptent. C'est le **numéro de version** qui
  tranche : une copie qui en déclare un plus ancien est en retard, et son
  contenu doit différer. Une copie n'est « retouchée » que si elle déclare la
  même version et diffère quand même.

## [0.9.1] - 2026-09-12

### Ajouté

- **`outils/repandre.js`** — le chaînon qui manquait. Le socle étant fait de
  fichiers recopiés, une correction ne se propage pas seule : cet outil fait la
  recopie, `etat.js` se contentant de signaler. Il distingue une copie **en
  retard** (elle ne diffère que par son numéro de version : on la remplace sans
  réfléchir) d'une copie **retouchée sur place**, qu'il refuse d'écraser sans
  `--meme-si-retouchee` — parce que c'est peut-être le projet qui a raison,
  comme la dispersion de `withRetry_` venue de `gdrive-shares-audit`.
- La comparaison se fait par **ensembles de lignes** et non position par
  position : une ligne insérée décale tout ce qui suit, et un compteur
  positionnel annonçait 60 différences pour un ajout d'une ligne. Un chiffre
  qui gonfle un pour soixante pousse à ignorer l'avertissement.

## [0.8.6] - 2026-09-12

**Couverture complète atteinte : 15 contrôles sur 15 dans un classeur lié,
aucun échec, fuseaux concordants.** Seul `SocleApi` reste non testé côté
Google — logique pure, déjà couverte par le banc.

Le classeur d'essai a rendu, avant la correction du fuseau, 14 contrôles sur
14, dont celui qu'on attendait :
**une chaîne de date écrite dans une cellule en ressort bien en objet `Date`**,
comme le banc le simule. C'est l'hypothèse sur laquelle repose tout
`SocleDates`, et elle n'avait jamais été vérifiée ailleurs que dans le
`CLAUDE.md` de l'auteur.

### Ajouté

- **Contrôle du fuseau du script contre celui du classeur.** `clasp create`
  pose le fuseau par défaut du compte Google, et non celui du classeur : le
  premier classeur d'essai est sorti en `America/New_York` quand le socle est
  en `Europe/Paris`. Six heures d'écart suffisent à ranger « la veille » toute
  date normalisée après 18 h — en silence, dans une colonne qui se trie. Le
  contrôle le signale désormais comme un échec, avec le remède : corriger
  `timeZone` dans `appsscript.json`.
- Le préparateur signale le même écart avant même de pousser.

### Corrigé

- **`preparer-essai.js` effaçait le `.clasp.json` du classeur d'essai.** Il
  supprimait le dossier entier avant de le réécrire, emportant le lien posé par
  `clasp create` — le classeur restait dans Drive, mais plus rien ne le
  désignait. `.clasp.json` et `appsscript.json` appartiennent à clasp : ils
  survivent maintenant à la régénération.

## [0.8.5] - 2026-09-12

### Corrigé

- **Le dossier d'essai était engendré dans le dépôt, où il ne pouvait pas
  servir.** `clasp` remonte les dossiers parents pour trouver un
  `.clasp.json` : depuis `socle-apps-script/essai/`, il trouvait celui du
  projet autonome, refusait de créer le classeur (« Project file already
  exists ») et — plus gênant — un `clasp push` lancé de là **repoussait le
  projet autonome sans prévenir**, en affichant des chemins commençant par
  `../`. Le dossier est désormais engendré **à côté** du dépôt, dans
  `socle-essai/`, et le LISEZMOI nomme le signe qui trahit l'erreur.
- `outils/etat.js` ignore ce dossier : ce n'est pas un projet à reprendre.

## [0.8.4] - 2026-09-12

### Ajouté

- **`outils/preparer-essai.js`** — assemble le dossier à pousser dans un
  classeur d'essai, pour couvrir les deux modules qu'un projet autonome ne peut
  pas tester : `SocleFeuilles` et le magasin de propriétés « document ».
- **Les fichiers y sont mis à plat**, sans sous-dossier : clasp transforme un
  dossier en préfixe de nom, et un projet hôte ordinaire n'en aura pas.
  L'essai doit se faire dans les mêmes conditions.
- **Un `Menu.gs` est engendré** — `onOpen()` est un déclencheur simple : le menu
  apparaît sans rien installer, et le contrôle s'exécute sous l'identité de qui
  l'ouvre. Le banc vérifie que ses entrées ne visent que des `function`
  déclarées, un menu résolvant sa cible par son nom global.
- **Le préparateur refuse d'écrire un dossier qui ne se chargerait pas** :
  il vérifie que le projet concaténé s'analyse et qu'aucun nom global n'y est
  déclaré deux fois.

## [0.8.3] - 2026-09-12

Deux défauts signalés par le journal du troisième essai réel — 13 contrôles
réussis, aucun échec, le socle tourne dans Apps Script.

### Corrigé

- **Une version affichée et fausse.** `SocleControle` annonçait 0.8.0 quand le
  socle était en 0.8.2 : le contrôle de version du banc ne portait que sur
  `modules/`, et la version de l'outil a dérivé dès le lendemain de son
  écriture. Le banc couvre désormais `outils/*.gs` — un outil qui ne porte
  aucune version reste autorisé, mais un outil qui en porte une doit porter la
  bonne. Le rapport l'affiche aussi en tête.
- **Un message de remède tronqué.** Le rapport coupait à 60 caractères le
  message expliquant l'absence du magasin « document » : il publiait donc un
  constat au lieu d'un remède. Message entier désormais, et une ligne par
  magasin — trois messages sur une seule ligne ne se lisent pas.

## [0.8.2] - 2026-09-12

Deux défauts trouvés par le **premier essai réel dans Apps Script**, que
267 assertions au banc ne voyaient pas — parce que les faux services étaient
plus permissifs que les vrais.

### Corrigé

- **`SocleExecution.sousVerrou` plantait dans un projet autonome.**
  `LockService.getDocumentLock()` rend **`null`** — il ne lève pas — quand le
  script n'est lié à aucun document : « Cannot read properties of null (reading
  'tryLock') ». Le module retombe désormais sur le verrou de script, et le
  **dit** dans son résultat (`portee: 'script'`) : une portée d'exclusion
  silencieusement élargie se découvre trop tard.
- **`SocleSecrets` en portée « document » rendait un message inutilisable.**
  Même cause : `getDocumentProperties()` rend `null`. Le message dit maintenant
  que le script n'est lié à aucun document, et propose les deux portées de
  remplacement.
- **Les faux services du banc rendent `null` eux aussi.** Ils rendaient
  toujours un objet, et validaient donc un code qui plantait en production. Les
  deux défauts, réintroduits, font échouer le banc.

### Confirmé en conditions réelles

- `HtmlService.XFrameOptionsMode` ne comporte bien que `ALLOWALL` et `DEFAULT` ;
  `DENY` n'existe pas. La conception de `SocleWeb.page()` reposait sur cette
  seule affirmation.
- `Utilities.sleep` dort vraiment : 2 403 ms mesurées pour trois tentatives.
- L'horloge est réelle : 1 201 ms mesurées après 1 200 ms de sommeil.
- `clasp` transforme bien un sous-dossier en préfixe de nom : le fichier à
  inclure s'appelle `modules/SocleStyle`, et non `SocleStyle`.
- **Le quota d'envoi d'un compte grand public est de 100 par jour**, contre
  1 500 pour un compte Workspace. `SocleCourriel.quotaDisponible` se comportera
  donc très différemment selon le compte d'essai.

## [0.8.1] - 2026-09-12

### Corrigé

- **`SocleControle` déclarait « absents » les onze modules pourtant chargés.**
  Il les cherchait par `globalThis[nom]` — or **une `const` de portée globale
  ne devient jamais une propriété de l'objet global** : seules les `function`
  déclarées et les `var` y arrivent. Le premier essai réel, dans Apps Script,
  a rendu « 0 réussi, 0 échec, 15 non testés ». La détection nomme désormais
  chaque identifiant en clair, pour que la recherche soit lexicale.
- **Le banc éprouve maintenant ce piège** : dans le bac à sable, `SocleDates`
  se trouve par son nom et `globalThis.SocleDates` vaut `undefined`. Le bac
  reproduisait fidèlement le comportement réel ; il manquait seulement de
  l'éprouver. S'y ajoute un contrôle sur le source : `SocleControle` ne doit
  employer aucun `globalThis[`.
- Le rapport annonce désormais combien de modules sont chargés, dans quelle
  version, et lesquels manquent.

## [0.8.0] - 2026-09-12

### Ajouté

- **`outils/SocleControle.gs`** — le contrôle qui se lance **dans** Google,
  depuis le menu d'exécution de l'éditeur. Il vérifie ce qu'aucun simulateur ne
  peut confirmer : l'énumération `XFrameOptionsMode` réelle, la distinction
  réelle des trois magasins de propriétés, le sommeil réel d'`Utilities.sleep`,
  le fuseau réel du script, et l'aller-retour d'une date par une cellule.
- **Il ne laisse rien derrière lui** : propriété temporaire et déclencheur
  ponctuel retirés dans un `finally`, même en cas d'échec en route. Et il
  **n'envoie aucun courriel** — le banc vérifie cette promesse sur le code.
- **« non testable ici » n'est pas « réussi »** : dans un projet autonome,
  `SocleFeuilles` et le magasin « document » sont annoncés comme non testés,
  avec la marche à suivre pour les tester.
- **Le piège du sous-dossier** : `clasp` pousse `modules/SocleStyle.html` sous
  le nom `modules/SocleStyle`, et non `SocleStyle`. Le contrôle essaie les deux
  et dit lequel employer.

## [0.7.0] - 2026-09-12

### Ajouté

- **`SocleLangues.gs`** — une seule signature, `traduire(langue, cle, valeurs)`,
  la langue toujours en premier. Les deux projets mesurés avaient la même
  fonction avec les arguments **inversés** : recopier une ligne de l'un vers
  l'autre rendait silencieusement « fr » au lieu du texte.
- **Une clé absente se voit** : `⟨cle⟩` et un compteur, là où les deux projets
  rendaient la clé telle quelle — une faute de frappe s'affichait à
  l'utilisateur sans que personne ne le sache. Même traitement pour un
  marqueur `{heure}` sans valeur, laissé visible.
- **Le pluriel, avec la règle française du zéro singulier** : « 0 fichier »
  contre « 0 files ». C'est la règle qu'un code pensé en anglais oublie.
- **`verifier()`** compare les tables : clés manquantes, clés en trop, et clés
  pluralisées d'un côté seulement — ce dernier cas ne fait manquer aucune clé
  et rend pourtant la phrase fausse dans une langue.
- Reprises telles quelles des projets, parce qu'elles ont été payées : ce qui
  est **structurel** ne se traduit pas, et une **langue inconnue** retombe sur
  le défaut sans lever.

### Notes

Avec ce module, la mesure ne désigne plus aucun motif à la fois répété et non
couvert. Le prochain viendra d'un portage réel, pas d'une intuition.

## [0.6.0] - 2026-09-12

### Ajouté

- **`SocleSecrets.gs`** — déclaration, lecture, écriture et inventaire des
  secrets. `portee` obligatoire et sans défaut (`partagee` / `document` /
  `personne`), `description` obligatoire, `masquer()` pour les journaux, et un
  `inventaire()` qui dit ce qui est en place sans rien révéler.
- **Ce que la mesure a réellement dit** : aucun secret en dur dans les six
  projets, mais 39 accès au magasin de script contre 4 au magasin de document
  et **aucun** à celui de la personne — alors que `portail-qr` y range des
  jetons OAuth individuels, sur une application web en « exécuter en tant que
  l'utilisateur qui accède ».
- **Trois magasins distincts au banc.** Un faux à magasin unique aurait fait
  passer un jeton rangé dans le partagé pour aussi isolé que dans celui de la
  personne — c'est-à-dire aurait validé le défaut.

### Écarté, mesuré

Impression, import et export ne passent pas la barre : le bloc `@media print`
de `SocleStyle` couvre l'impression, la génération de PDF n'apparaît qu'une
fois dans un seul projet, `Utilities.parseCsv` zéro fois, et l'export est
concentré dans `gdrive-shares-audit` seul.

## [0.5.0] - 2026-09-12

### Ajouté

- **`SocleExecution.gs`** — budget de temps, verrou de document, déclencheur de
  reprise. Le motif le plus répandu du corpus : 54 occurrences dans cinq
  projets sur six. `permet(ms)` plutôt que `reste() > 0` : on ne démarre pas
  une unité sur un budget entamé.
- **`SocleApi.gs`** — `parcourir` pour la pagination (26 occurrences, quatre
  projets). Borne de pages contre la boucle infinie, arrêt possible sur budget,
  et surtout : **un parcours partiel ne se dit jamais complet**.

### Notes

Avec ces deux modules, tout ce que la mesure plaçait au-dessus de la barre est
couvert, sauf l'internationalisation — 253 occurrences mais deux projets, et
la forme la plus susceptible d'être revue par un premier portage réel.

## [0.4.0] - 2026-09-12

### Ajouté

- **`SocleWeb.gs`** — `inclure` (le scriptlet de gabarit, qu'un seul projet
  avait écrit), `page` (titre, viewport, mode X-Frame par booléen plutôt que
  par nom de mode : l'énumération ne comporte que `ALLOWALL` et `DEFAULT`), et
  `frontiere`, qui rend une forme unique au navigateur au lieu de lever.
- **`SocleWebClient.html`** — `echapper`, `appeler` (l'enveloppe en promesse,
  trouvée copiée deux fois à l'identique dans un même dépôt) et `demander`.
- **Test croisé client / serveur** : l'échappement du navigateur doit rendre
  exactement ce que rend `SocleTexte.echapperHtml`. Dans les projets mesurés,
  le client en couvrait quatre caractères et le serveur cinq — une divergence
  que rien ne signalait.
- **Ce qui motive `frontiere`** : les quatre applications web mesurées
  affichaient `erreur.message` brut. Une exception imprévue parvenait telle
  quelle à un utilisateur du métier.

## [0.3.0] - 2026-09-12

### Ajouté

- **`SocleErreurs.gs`** — trois sorts pour un échec, et il faut en nommer un :
  `absorber` (prévu, sans conséquence : repli rendu **et** compté),
  `erreur`/`throw` (empêche de continuer : `quoiFaire` obligatoire), signaler
  (concerne quelqu'un d'autre : affaire de `SocleCourriel`). Entré par mesure —
  118 exceptions levées dans six projets dont 9 disaient quoi faire, et 17
  `catch` décidant en silence qu'un échec n'avait pas eu lieu.
- **`absorber` compte au lieu d'avaler.** C'est toute la différence avec un
  `catch` muet : `bilan()` permet de dire « 12 Drives dont les membres n'ont
  pas pu être lus » plutôt que de laisser croire qu'ils n'en avaient pas.
- **`pourLUtilisateur` et `pourLeJournal`** : deux textes du même échec. Une
  exception imprévue n'est jamais déguisée en conseil de saisie.
- **Contrôle au banc : tout message levé par le socle dit quoi faire ensuite.**
  Une règle qu'on écrit sans la faire respecter est un vœu — au moment où ce
  contrôle a été posé, le socle échouait sur 15 de ses 15 messages.

### Modifié

- **Les 15 messages d'erreur du socle** portent désormais leur remède.
- **`SocleReprises.appelHttp`** : message aplati. Des gabarits imbriqués dans
  des ternaires rendaient illisible ce que le message disait vraiment — c'est
  le nouveau contrôle qui l'a révélé, en butant dessus.

## [0.2.0] - 2026-09-12

### Ajouté

- **`SocleCourriel.gs`** — trois natures de message, classées non par gravité
  mais par ce qu'on attend du destinataire : rien (`information`), un acte
  (`erreur`), une réponse (`question`). Une erreur sans `quoiFaire` et une
  question sans `repondreVia`/`avantLe` ne partent pas : ces refus sont
  l'essentiel du module. Anti-répétition par cause, borné à six heures et
  **avoué** — le message qui repart dit combien de fois la cause est survenue
  entre-temps. Quota lu avant l'envoi.
- **`SocleStyle.html`** — style commun des interfaces, base neuve en français,
  proche de Material. Entré par duplication mesurée : trois projets portaient
  trois palettes (35, 26 et 13 couleurs littérales), trois jeux de variables
  CSS (17, 28, 9) et des noms de classes en anglais dans deux d'entre eux.
  Les composants suivent ce que les interfaces contiennent — les onglets,
  jamais employés, n'y sont pas. Thème sombre et bloc d'impression compris.
- **Les cinq états avant tout le reste.** `critique`, `sérieux`,
  `avertissement`, `bon`, `neutre` : le vocabulaire de `Classify.gs`, mesuré
  105 fois dans les trois interfaces — plus souvent que les boutons. La couleur
  ne porte jamais seule l'information.
- **`outils/galerie.js`** — assemble la galerie des composants depuis la
  source, sans jamais recopier le CSS. Le banc vérifie dans les deux sens que
  la galerie et la feuille disent la même chose.
- **Contrôles de la feuille au banc** : version déclarée conforme au fichier
  VERSION et lisible depuis le navigateur, aucun jeton utilisé sans définition
  ni défini sans usage, thème sombre limité aux jetons du thème clair, aucune
  couleur littérale hors des jetons (seule exception nommée : le bloc
  d'impression), préfixe `s-` partout, et noms de classes en français.
- **Second critère d'admission, nommé.** Ce module n'est pas entré par
  duplication — la mesure disait l'inverse, quatre envois dans tout le corpus —
  mais par une absence qui coûte : aucun outil ne prévient quand il échoue en
  arrière-plan. Le critère est désormais écrit dans le README et le CLAUDE.md,
  plutôt que laissé à l'appréciation du moment.

- **`outils/SondeES.gs`** — à recopier dans un projet Apps Script et à exécuter
  une fois depuis l'éditeur. Google annonce que V8 « prend en charge la syntaxe
  ECMAScript moderne » sans jamais nommer de version garantie : il n'y a donc
  aucune page à citer, et ce qui est disponible se mesure dans le moteur qui
  exécutera le code. Trente constructions essayées, d'ES2015 à ES2024, chacune
  via `eval` — écrite en clair, une construction non analysable ferait échouer
  le chargement du fichier entier au lieu de rendre un résultat.

## [0.1.0] - 2026-09-12

Première version. Le contenu n'a pas été choisi a priori : il vient d'une
mesure sur six projets et 17 400 lignes de `.gs`, qui a montré où le même code
était réécrit — et surtout où les copies avaient cessé de dire la même chose.

### Ajouté

- **`SocleDates.gs`** — normalisation à la lecture, deux formats séparés
  (`yyyy-MM-dd` pour stocker, « 6 septembre 2026 » pour lire), refus de
  deviner. Remplace cinq implémentations divergentes, dont une qui lisait
  `01/02/2026` comme le 2 janvier et une qui codait le fuseau en dur.
- **`SocleTexte.gs`** — échappement à cinq remplacements, et `urlSure` qui
  filtre le schéma. Remplace quatre implémentations, dont une à trois
  remplacements qui laissait passer les guillemets.
- **`SocleFeuilles.gs`** — colonnes par en-tête, écriture par lots, réglages
  lus et écrits par clé, complétion additive qui ne réécrit jamais une valeur
  déjà renseignée.
- **`SocleReprises.gs`** — réunit les deux moitiés qui vivaient chacune dans
  un seul projet : le tri des erreurs transitoires avec reprise à attentes
  doublantes, et l'appel HTTP qui rejoue les 429 et 5xx puis lève avec le code
  **et** le corps de la réponse.
- **`outils/etat.js`** — rapport de divergence : quels modules chaque projet
  embarque, lesquels ont dérivé de la source, et ce qui reste écrit à la main
  que le socle couvrirait. Ne modifie rien.
- **Banc d'essai** : 78 assertions hors de Google, dont deux invariants qui
  priment sur les autres — chaque module se charge seul, et aucun nom de
  portée globale n'est déclaré deux fois. Éprouvé en réintroduisant cinq
  défauts observés dans les projets réels ; chacun le fait échouer.

### Notes de conception

- **Fichiers recopiés plutôt qu'une bibliothèque Apps Script.** Google
  documente le ralentissement à l'exécution et l'impossibilité d'y poser un
  point d'arrêt ; s'y ajoute le suivi d'un numéro de version de déploiement
  par projet hôte. Reste non vérifié : si les portées OAuth d'une bibliothèque
  s'ajoutent à celles de l'appelant — auquel cas la question serait tranchée
  dans l'autre sens pour un outil d'administration.
- **Aucune dépendance entre modules.** `SocleFeuilles` rend les valeurs brutes
  — une cellule de date ressort en objet `Date` — et laisse la normalisation à
  l'appelant, pour n'imposer aucune forme de données.
- **Préfixe sur tous les noms internes.** Deux constantes globales de même nom
  empêchent le projet hôte entier de se charger.
