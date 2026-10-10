<a id="francais"></a>

# Socle Apps Script

📖 Français (ci-dessous) · [🇬🇧 English version](#english)

Quatre modules à recopier dans un projet Apps Script, pour ne plus réécrire —
et surtout ne plus réécrire **différemment** — ce qu'on écrit dans chaque
outil : normaliser une date, échapper du HTML, lire un onglet par en-tête,
rejouer une erreur passagère.

## Le constat qui l'a déclenché

Mesuré sur six projets, 17 400 lignes de `.gs`.

**La normalisation de date existe en cinq versions qui ne font pas la même
chose** : trois formats de sortie, un fuseau codé en dur au lieu de
`Session.getScriptTimeZone()`, une qui fait `new Date(valeur)` sur une chaîne
— donc qui lit `01/02/2026` comme le 2 janvier — et un projet qui n'en a pas
du tout et appelle `Utilities.formatDate` en ligne, trois fois, trois formats.

**L'échappement HTML existe en quatre versions, dont une à trois
remplacements** au lieu de cinq : ni `"` ni `'`. Une valeur posée dans un
attribut à guillemets simples n'y est pas protégée.

**Ce qui marche le mieux n'existe qu'une fois.** Le tri des erreurs
transitoires ne vit que dans un projet ; la reprise HTTP à backoff dans un
autre. Ce sont deux moitiés complémentaires — l'une rattrape les exceptions
des services Apps Script, l'autre les codes HTTP que `UrlFetchApp` ne lève
pas — et aucun projet n'a les deux.

## Pourquoi des fichiers recopiés, et non une bibliothèque

La question mérite d'être tranchée explicitement, puisque c'est le contraire
de ce que le mot « bibliothèque » suggère.

Une vraie bibliothèque Apps Script propage une correction sans toucher aux
projets — c'est son seul avantage, et il est réel. Trois choses jouent contre,
dont deux que Google documente :

- **elle ralentit l'exécution.** « A script that uses a library doesn't run as
  quickly as it would if all the code were contained within a single script
  project. » Sous un plafond de six minutes, ce n'est pas un détail de confort ;
- **on ne peut pas y poser de point d'arrêt** ni y entrer au débogueur ;
- **chaque projet hôte doit suivre un numéro de version de déploiement.** Une
  correction n'arrive nulle part tant qu'on n'a pas republié la bibliothèque
  **et** repointé chaque hôte.

Un point reste **non vérifié** : je n'ai pas trouvé sur la documentation si les
portées OAuth exigées par une bibliothèque s'ajoutent à celles du script
appelant. Si c'était le cas, un socle unique imposerait à tous les projets
l'union de toutes les portées — ce qui condamnerait l'idée pour un outil
d'administration. À vérifier avant de revenir sur ce choix.

Le prix de la recopie, lui, est connu : les copies divergent. C'est pourquoi
`outils/etat.js` existe — il rend la divergence visible au lieu de la nier.

## Les quatre modules

Chacun se recopie seul. **Aucun ne dépend d'un autre**, et le banc le vérifie
en chargeant chaque module dans un bac à sable où lui seul existe.

### `SocleDates.gs`

Normaliser **à la lecture**, jamais à l'écriture : on ne maîtrise pas ce que
Sheets fait d'une valeur en la stockant. Deux formats, et pas un seul —
`yyyy-MM-dd` pour stocker parce que c'est le seul qui se trie en tant que
texte, « 6 septembre 2026 » pour lire parce qu'une interface s'adresse à des
humains.

Il **ne devine jamais**. Seules deux écritures sont acceptées, ISO et
`jj/mm/aaaa` ; tout le reste rend `''`, à charge pour l'appelant de dire « non
mesuré » plutôt que d'inventer. Un nombre est refusé de la même façon : rien
ne distingue un numéro de série Sheets d'un identifiant, et se tromper y coûte
une date en 1899.

Les noms de mois sont une table explicite, pas `formatDate(…, 'MMMM')` — qui
suit la locale du script et non la langue demandée.

### `SocleTexte.gs`

Les cinq remplacements, `&` en premier. Et `urlSure`, qui filtre le schéma :
`javascript:alert(1)` ne contient aucun caractère à échapper et s'exécute tout
de même — échapper ne suffit pas.

### `SocleFeuilles.gs`

Les colonnes se retrouvent par en-tête, jamais par indice. On écrit par lots.
Le code complète le référentiel et ne réécrit jamais une décision humaine. Et
un onglet **présent mais vide n'est pas un onglet absent** — les confondre
laisse un onglet sans en-tête, et la première clé se retrouve en ligne 1 où
elle passe pour un titre de colonne.

Asymétrie voulue : **écrire crée l'onglet, lire ne le crée pas.** Lire un
onglet absent est presque toujours une faute de frappe, et le créer à la volée
rendrait un tableau vide qu'on lirait « aucune donnée » au lieu de « mauvais
onglet ».

### `SocleLangues.gs`

253 occurrences dans deux projets, et **deux implémentations qui se
contredisent** : `t_(langue, cle)` dans l'un, `t_(cle, langue)` dans l'autre.
Recopier une ligne de l'un vers l'autre ne lève rien — la fonction cherche une
clé nommée « fr » et rend « fr ». Ce genre de divergence ne se voit qu'en
production, dans une langue qu'on ne relit pas.

Une seule signature, donc : **la langue vient toujours en premier**.

Deux règles reprises telles quelles de tes projets, parce qu'elles ont été
payées : **ce qui est structurel ne se traduit pas** — en-têtes de colonnes,
clés de réglage, valeurs de listes déroulantes restent en français dans les
deux langues, ce sont des identifiants et non de la prose ; et **une langue
inconnue retombe sur le défaut**, jamais sur une exception.

Une règle changée : **une clé absente se voit**. Les deux projets rendaient la
clé telle quelle, si bien qu'une faute de frappe s'affichait à l'utilisateur
sans que personne ne le sache. Ici elle rend `⟨cle⟩` — les chevrons disent
« ceci est un défaut », pas « ceci est un libellé » — et elle est comptée.
Même traitement pour un marqueur `{heure}` sans valeur, qui reste visible :
« Sauvegardé à  » passerait inaperçu.

**Le pluriel, avec la règle qui sépare vraiment les deux langues** : en
français, zéro prend le **singulier** — « 0 fichier » — alors que l'anglais le
met au pluriel — « 0 files ». C'est celle qu'un code pensé en anglais oublie
systématiquement.

`verifier()` compare les tables entre elles : clés manquantes, clés en trop, et
**clés pluralisées d'un côté seulement** — ce dernier cas ne fait manquer
aucune clé et rend pourtant la phrase fausse dans une langue. À appeler depuis
le banc du projet hôte.

### `SocleSecrets.gs`

La mesure a démenti le soupçon : **aucun secret n'est écrit en dur** dans les
six projets. Ce qu'elle a trouvé est plus discret — sur 43 accès aux
propriétés, 39 vont au magasin **de script**, 4 à celui **du document**, et
**aucun** à celui **de la personne**.

Les trois ne protègent pourtant pas les mêmes choses. Le magasin de script est
unique pour tout le projet : ce qu'une personne y écrit, toute exécution peut
le lire — y compris celle d'une autre personne, sur une application web
déployée en « exécuter en tant que l'utilisateur qui accède ». Un jeton OAuth
personnel y est isolé par la seule discipline du code qui le lit ;
`getUserProperties()` rend cette isolation structurelle.

D'où la seule exigence du module : **`portee` est obligatoire**, sans valeur
par défaut — une valeur par défaut serait la reconduction silencieuse du choix
qu'on ne fait pas. `description` l'est aussi : « CLE_API » tout seul n'a jamais
appris à personne où aller la chercher.

`inventaire()` répond « la clé est renseignée » sans la faire apparaître — au
plus quatre caractères, et seulement si la valeur est assez longue pour qu'ils
n'en disent rien. Il distingue **manquante** (obligatoire et absente),
**absente** (facultative) et **illisible** (magasin inaccessible) : une colonne
vide veut dire non mesuré, jamais rien trouvé.

### `SocleExecution.gs`

Le motif le plus répandu du corpus : **54 occurrences dans cinq projets sur
six**. Trois primitives qui vont toujours ensemble.

Le fait qui commande tout : une exécution qui atteint six minutes n'est pas
interrompue, elle est **tuée**. Ce qui n'est pas parti vers Google n'existe pas
pour la reprise.

- `budget()` → `permet(ms)`, et non `reste() > 0`. **On ne démarre pas une
  unité sur un budget entamé** : le pari coûte l'exécution entière, alors que
  la suivante repartira avec ses six minutes. C'est la nuance qui manque à la
  plupart des boucles écrites à la main ;
- `sousVerrou(operation)` — verrou **de document** et non de script, attente
  nulle, `releaseLock` dans un `finally`. Celui qui arrive second n'a rien
  d'utile à faire, et l'attente ne ferait que consommer son propre budget ;
- `programmerReprise(nom, delai)` — ramasse les précédents, vérifie que la
  cible est une `function` déclarée, et refuse au-delà des vingt déclencheurs
  autorisés par utilisateur et par script.

`plan-puis-application` porte aujourd'hui sa propre copie de ces primitives.
Les faire converger est une étape à part, qui se vérifiera à son banc — pas
un effet de bord de celle-ci.

### `SocleApi.gs`

26 occurrences dans quatre projets, toutes de la même forme : une boucle
`do … while (pageToken)`. Écrite à la main, elle porte deux fois le même
défaut — aucune borne, et aucun moyen de s'arrêter avant les six minutes.

`parcourir(appel, { champ })` rend `{ elements, pages, jetonSuivant, complet }`.
**Un parcours partiel ne se fait jamais passer pour complet** : `complet:
false` et le jeton pour reprendre. C'est le défaut des boucles manuelles,
qui rendent un tableau tronqué sans que l'appelant le sache.

### `SocleErreurs.gs`

Entré par une mesure, pas par une intuition : sur six projets, **118 exceptions
levées dont 9 disent quoi faire ensuite** (8 %), et **17 blocs `catch` qui
décident en silence qu'un échec n'a pas eu lieu**.

Le défaut n'est pas d'absorber un échec — un cache qui ne répond pas ne doit
pas arrêter une génération. Le défaut est que **rien ne distingue « ça n'a pas
eu lieu » de « je n'ai pas su »**. Dans l'audit des partages, un Drive dont les
membres sont illisibles rend une liste vide, et la liste vide devient
« propriétaire inconnu » ; deux autres `catch` font disparaître un fichier d'un
rapport qui se déclare complet. Un rendu faux qui se dit réussi coûte plus cher
qu'un échec, parce que personne ne va chercher la cause d'un succès.

Trois sorts, et il faut en nommer un :

| | Quand | Ce que le module impose |
| --- | --- | --- |
| `absorber` | l'échec est prévu et sans conséquence sur le résultat | une **cause nommée**, et un compteur — le repli est rendu, la trace reste |
| `erreur` puis `throw` | l'échec empêche de continuer | **`quoiFaire`** : pas de remède, pas d'erreur |
| signaler | l'échec concerne quelqu'un d'autre que celui qui exécute | rien ici : on passe le bilan à `SocleCourriel.erreur` |

`bilan()` rend les causes agrégées, la plus fréquente en tête, avec le premier
et le dernier message. C'est ce qui permet à un compte rendu de dire « 12
Drives dont les membres n'ont pas pu être lus » au lieu de laisser croire
qu'ils n'avaient pas de membres.

`pourLUtilisateur()` et `pourLeJournal()` tirent deux textes du même échec — ce
qu'un utilisateur final lit n'est pas ce qu'un administrateur lit. Et une
exception imprévue n'est jamais déguisée en conseil de saisie : faire passer un
défaut du code pour une faute de l'utilisateur l'envoie corriger ce qui n'a
rien à se reprocher.

### `SocleCourriel.gs`

Le seul module qui ne soit **pas** entré par la duplication : la mesure dit
l'inverse — quatre envois dans tout le corpus, et aucune notification d'erreur.
Il est entré par l'absence. Des outils qui tournent sur déclencheurs, en
arrière-plan, et rien qui prévienne quand ils échouent : les erreurs partent
dans `console.error`, c'est-à-dire dans un journal que personne n'ouvre.

L'axe de classement n'est pas la gravité, c'est **ce qu'on attend du
destinataire** — rien, un acte, ou une réponse :

| | On attend | Le module exige | Le piège |
| --- | --- | --- | --- |
| `information` | rien | un objet | trois de trop et le destinataire pose un filtre, qui emportera aussi les erreurs |
| `erreur` | un acte | **`quoiFaire`** | dire ce qui a échoué plutôt que quoi faire ; et inonder |
| `question` | une réponse | **`repondreVia` et `avantLe`** | une question sans échéance est une information déguisée |

Ces refus sont l'essentiel : sans eux, le module ne serait qu'un habillage de
`MailApp`. Une erreur sans remède ne part pas.

L'anti-répétition agrège **par cause et non par victime** — un manager parti
produit une ligne, pas trois cents messages. Le silence est borné (six heures
par défaut) et **avoué** : le message qui repart dit combien de fois la cause
est survenue entre-temps, parce qu'un silence qui cacherait le volume mentirait
sur l'ampleur.

Le suivi des réponses n'est volontairement pas assuré : le module seul ne peut
pas savoir ce qui vaut réponse. Il rend une référence que l'appelant consigne
là où vit son état — typiquement la ligne d'un plan, qui passera de « À faire »
à « Fait » quand la réponse arrivera.

`MailApp` et non `GmailApp` : il ne sait qu'envoyer, aucune portée de lecture
de la messagerie n'est demandée.

Le quota d'envoi **dépend du type de compte** : 100 par jour sur un compte
grand public, 1 500 sur un compte Workspace (mesuré le 12 septembre 2026). Un
essai concluant sur un compte personnel ne dit donc rien de ce qui tiendra en
production, et inversement.

### `SocleReprises.gs`

**Le tri vaut la reprise**, et c'est la moitié qu'on oublie. Trois essais à
attentes doublantes coûtent 2,4 secondes par appel voué à échouer ; sur trois
cents appels, douze minutes de sommeil pur, soit deux fois le plafond d'une
exécution. Un backoff sans tri ne rend pas un outil robuste, il le rend lent à
échouer.

Jamais de valeur de repli : la fonction relève. C'est à l'appelant de décider
quoi faire d'un échec **et de pouvoir le dire** — une fonction qui rend `null`
en cas de panne transforme « je n'ai pas su lire » en « il n'y a rien », et
envoie quelqu'un chercher une donnée qui est déjà là.

### `SocleWeb.gs` et `SocleWebClient.html`

Les deux moitiés du même sujet : ce que le serveur sert, et ce que le
navigateur en fait.

La mesure a trouvé quatre `doGet` de quatre formes, une enveloppe de
`google.script.run` **copiée deux fois à l'identique dans le même dépôt**, un
échappement client à quatre caractères là où le serveur en couvre cinq, et —
le plus coûteux — **les quatre projets affichant `erreur.message` brut à
l'utilisateur**. Une exception imprévue arrive donc telle quelle sous les yeux
de quelqu'un du métier, en « Cannot read properties of undefined ».

Côté serveur :

- `inclure(nom)` — le contenu d'un fichier pour un scriptlet de gabarit. C'est
  ce qui permet d'inclure `SocleStyle` ; un seul projet l'avait écrit ;
- `page({ fichier, titre, integrable })` — titre, balise `viewport` et mode
  X-Frame. Le paramètre est un **booléen** et non un nom de mode, parce que
  l'énumération ne comporte que `ALLOWALL` et `DEFAULT` : un `DENY` écrit de
  mémoire vaudrait `undefined` et ferait échouer l'appel. Le défaut est fermé ;
- `frontiere(nom, operation)` — enveloppe une fonction appelée par le
  navigateur et **rend une forme unique** :

  ```
  { ok: true,  valeur }
  { ok: false, message, reference }
  ```

  Elle rend au lieu de lever, parce que ce qui traverse `google.script.run`
  n'est pas garanti de porter les champs propres d'une `Error`. Une erreur qui
  porte un `quoiFaire` — ce que construit `SocleErreurs` — transmet son remède ;
  toute autre **dit qu'elle est imprévue** et donne une référence horodatée à
  citer, pendant que le détail technique reste dans le journal, côté
  administrateur.

Côté navigateur, sous l'objet `socle` :

- `echapper(texte)` — les cinq remplacements. **Le banc vérifie qu'il rend
  exactement ce que rend `SocleTexte.echapperHtml`** : deux moitiés du même
  geste, dans deux fichiers, que rien d'autre ne tient ensemble ;
- `appeler(nom, args)` — l'enveloppe en promesse ;
- `demander(nom, args)` — le pendant de la frontière : rend la valeur, ou
  rejette avec le message destiné à l'utilisateur. Le navigateur n'a jamais à
  décider si ce qu'il a reçu est lisible par un humain.

### `SocleStyle.html`

Le style des interfaces — applications web, boîtes de dialogue, barres
latérales. Un seul fichier, sans JavaScript, à inclure dans une page servie par
`HtmlService` :

```html
<?!= HtmlService.createHtmlOutputFromFile('SocleStyle').getContent(); ?>
```

La page hôte doit alors être créée par `createTemplateFromFile(…).evaluate()`,
sinon les scriptlets ne sont pas évalués. Un projet qui assemble déjà sa page à
la construction — comme l'audit des partages avec `build_apps_script.py` — peut
l'y injecter au même moment.

Aucun fichier `.gs` ne l'accompagne : un module de style n'a pas de code, et
lui donner un jumeau en `.gs` poserait la question, que rien dans la
documentation ne tranche, de savoir si un projet Apps Script accepte deux
fichiers de même nom et d'extensions différentes.

**Les cinq états d'abord.** La mesure les a trouvés 105 fois dans les trois
interfaces — plus que les boutons. Le vocabulaire vient de `Classify.gs`
(`critical`, `serious`, `warning`, `good`, `neutral`), traduit : un système de
design qui ne l'exprimerait pas serait générique. La couleur ne porte jamais
seule l'information : une pastille et un libellé la doublent.

**Toutes les classes portent le préfixe `s-`**, pour la même raison que les
noms globaux en JavaScript : ce fichier atterrit dans des projets qui ont déjà
leur CSS, et une classe `.carte` y entrerait en collision sans prévenir.

Les composants suivent ce que les interfaces contiennent réellement : boutons,
champs, tableaux, chiffres clés, bandeaux, progression, cartes, boîte modale.
Les onglets, jamais employés nulle part, n'y sont pas. Thème sombre par
`prefers-color-scheme`, et un bloc d'impression — ces outils produisent des
rapports, qui finissent en PDF.

Pour la voir :

```bash
node outils/galerie.js && open galerie-rendue.html
```

La galerie n'embarque pas de copie du CSS : elle l'injecte depuis la source, et
le banc vérifie dans les deux sens qu'elle montre exactement ce que la feuille
définit — ni classe fantôme, ni composant jamais montré.

## Lever, ou rendre vide ?

Les modules ne répondent pas tous pareil, et ce n'est pas une incohérence — la
règle est la suivante, et chacun s'y tient :

- **on rend une valeur vide quand l'absence est une information exploitable.**
  `SocleDates.jour()` rend `''` sur ce qu'il ne sait pas lire ; `lireReglages`
  rend `{}` sur un onglet absent, pour qu'une installation puisse le compléter.
  Dans les deux cas, l'appelant peut continuer et **dire** que la valeur n'est
  pas mesurée ;
- **on lève quand l'échec empêche de continuer.** `lireTable` lève sur un
  onglet absent, parce qu'un tableau vide se lirait « aucune donnée » alors que
  c'est « mauvais onglet » ;
- **on ne rend jamais de repli silencieux depuis une fonction qui a essayé.**
  `SocleReprises.avecReprises` relève : c'est à l'appelant de décider quoi
  faire de l'échec, et surtout de pouvoir le dire. Un `null` rendu en cas de
  panne transforme « je n'ai pas su lire » en « il n'y a rien ».

Le banc fait respecter la moitié visible de cette doctrine : **tout message
levé par le socle doit dire quoi faire ensuite**. Au moment où ce contrôle a
été écrit, le socle échouait sur 15 de ses 15 messages.

## S'en servir

Recopier le ou les fichiers voulus dans le projet, et appeler :

```js
const arrivee = SocleDates.jour(ligne['Date d’arrivée']);   // '2026-01-05' ou ''
const titre   = SocleTexte.echapperHtml(personne.nom);
const table   = SocleFeuilles.lireTable('RH');
const photo   = SocleReprises.avecReprises(() => DriveApp.getFileById(id));
```

Aucune portée OAuth n'est ajoutée par le socle lui-même : chaque module
n'utilise que les services que le projet appelle déjà.

## L'état des copies

```bash
node outils/etat.js
```

Pour chaque projet voisin : quels modules y sont embarqués, lesquels ont
divergé de la source, et **ce qui reste écrit à la main** que le socle
couvrirait — avec le compte exact. C'est la carte de reprise, et elle ne
modifie rien : la décision de recopier appartient à qui connaît le projet.

### Répandre une mise à jour

Le socle est fait de fichiers recopiés : une correction ne se propage pas toute
seule. `outils/repandre.js` fait la recopie — mais pas la décision.

```bash
node outils/repandre.js                       # rapport seul, ne touche à rien
node outils/repandre.js --appliquer <projet>  # recopie ce qui est en retard
node outils/repandre.js --appliquer toutes
```

Il distingue deux situations, et c'est tout son intérêt :

- **en retard** — la copie ne diffère que par son numéro de version. On la
  remplace sans réfléchir ;
- **retouchée sur place** — la copie diffère par autre chose. Quelqu'un l'a
  modifiée, et **c'est peut-être le projet qui a raison** : c'est exactement ce
  qui vient d'arriver avec la dispersion de `withRetry_`, remontée de
  `gdrive-shares-audit` dans le socle plutôt que l'inverse. Celle-là n'est pas
  écrasée sans `--meme-si-retouchee`, et l'outil montre les lignes en cause.

La comparaison se fait par **ensembles de lignes**, non position par position :
une seule ligne insérée décale tout ce qui suit, et un compteur positionnel
annoncerait soixante différences pour un ajout. Un chiffre qui gonfle un pour
soixante pousse à ignorer l'avertissement.

Après une recopie, **relancer le banc du projet** : c'est lui qui dit si la
mise à jour casse quelque chose, et l'outil le rappelle.

Un module divergent n'est pas forcément une erreur. C'est peut-être le projet
qui a raison, et la correction qui doit remonter dans le socle.

## Le contrôle dans Google

Le banc prouve la cohérence interne du socle **hors** de Google. Il ne prouve
rien de ce que Google fait réellement. Pour cela, `outils/SocleControle.gs` se
pose dans le projet Apps Script et se lance depuis le menu d'exécution :

```
Éditeur Apps Script → fonction « controlerLeSocle » → Exécuter → Journal d'exécution
```

Il vérifie ce qu'aucun simulateur ne peut confirmer : que
`HtmlService.XFrameOptionsMode` ne comporte bien que `ALLOWALL` et `DEFAULT`
et qu'un `DENY` n'existe pas, que les trois magasins de propriétés sont
réellement distincts et lesquels sont accessibles depuis ce projet, que
`Utilities.sleep` dort vraiment, que le fuseau du script est celui qu'on croit,
et — dans un projet lié à un classeur — qu'une chaîne de date ressort bien en
objet `Date`, comme le banc le simule.

**Résultat au 12 septembre 2026** : 15 contrôles sur 15 dans un classeur lié,
aucun échec. Seul `SocleApi` reste non testé côté Google — logique pure, sans
appel à un service, déjà couverte par le banc.

Quatre exécutions réelles ont été nécessaires pour y arriver, et **elles ont
trouvé sept défauts que 270 assertions ne voyaient pas** : une détection de
modules par `globalThis` qui ne pouvait pas fonctionner, deux services rendant
`null` au lieu de lever, une version d'outil qui dérivait, un dossier d'essai
imbriqué que clasp ne pouvait pas créer, un préparateur qui effaçait le lien
vers le classeur, et un fuseau horaire à six heures du bon. Aucun n'était
visible hors de Google.

Trois garanties :

- **il ne modifie rien de durable.** Propriété temporaire et déclencheur
  ponctuel sont retirés dans un `finally`, y compris si un contrôle échoue en
  route ;
- **il n'envoie aucun courriel.** Seuls les refus de `SocleCourriel` sont
  éprouvés, qui lèvent avant d'envoyer. Le banc vérifie cette promesse sur le
  code source ;
- **ce qu'il ne peut pas tester, il le dit.** « non testable ici » n'est pas
  « réussi », et le rapport le rappelle.

### Couvrir les deux modules qui manquent

Un projet autonome ne peut tester ni `SocleFeuilles`, qui a besoin d'un
classeur, ni le magasin de propriétés « document », qui n'existe que pour un
script lié. Pour les couvrir :

```bash
node outils/preparer-essai.js
cd ../socle-essai
clasp create --type sheets --title "Socle — classeur d'essai"
clasp push
```

Le dossier est engendré **à côté** du dépôt, et non dedans : `clasp` remonte
les dossiers parents pour trouver un `.clasp.json`, et il trouverait celui du
projet autonome — refusant alors de créer le classeur, et repoussant le projet
autonome au `push` suivant. Les chemins affichés commençant par `../` sont le
signe qui trahit l'erreur.

`clasp create` crée le classeur **et** son script lié. Ouvrez ensuite le
classeur : le menu **Socle > Contrôler le socle** apparaît — `onOpen()` est un
déclencheur simple, il n'y a rien à installer.

Le dossier est **assemblé depuis la source**, jamais recopié : un dossier
d'essai qui porterait sa propre copie des modules finirait par tester autre
chose que ce que le socle contient. Il est engendré à plat, sans sous-dossier,
pour se trouver dans les mêmes conditions qu'un projet hôte ordinaire — et le
préparateur refuse d'écrire un dossier qui ne se chargerait pas.

Le contrôle y crée un onglet temporaire, l'écrit, le relit et **le supprime**
dans un `finally`. C'est là qu'il vérifie en vrai ce que le banc ne fait que
simuler : qu'une chaîne de date écrite dans une cellule en ressorte en objet
`Date`.

### Le piège du sous-dossier

`clasp` pousse un dossier comme un **préfixe de nom** : `modules/SocleStyle.html`
devient le fichier `modules/SocleStyle` dans l'éditeur, et non `SocleStyle`.
`SocleWeb.inclure('SocleStyle')` échouerait donc. Le contrôle essaie les deux
noms et dit lequel employer.

## Le banc

```bash
node banc/test.js
```

270 assertions, hors de Google. Les faux services refusent ce que les vrais
refusent — et le faux `Utilities.formatDate` rend des noms de mois **en
anglais**, de sorte qu'un module qui s'en servirait pour afficher « septembre »
se fait prendre immédiatement.

Le banc a été éprouvé en y réintroduisant dix défauts. Cinq relevés dans les
projets réels — échappement à trois remplacements, date devinée par
`new Date()`, noms de mois par `formatDate`, dépendance croisée entre modules,
backoff sans tri — et cinq sur les courriels : remède rendu facultatif,
échéance rendue facultative, compteur d'occurrences retiré, quota lu après
l'envoi, marqueur d'objet supprimé. Chacun le fait échouer.

## Deux portes d'entrée, pas une

Un module entre ici pour l'une de ces deux raisons, et il faut le dire
explicitement plutôt que de laisser la règle dériver :

1. **une duplication mesurée** — `outils/etat.js` montre que le code est déjà
   réécrit, et différemment, dans plusieurs projets ;
2. **une absence mesurée qui coûte** — personne ne l'a écrit, et c'est
   précisément le problème. Un module admis à ce titre doit porter une
   **doctrine**, c'est-à-dire des refus, et non des utilitaires : `SocleCourriel`
   refuse une erreur sans remède, `SocleReprises` refuse de rejouer un échec
   certain.

Sans ce second critère nommé, on se convainc au cas par cas — et l'on retombe
sur la boîte à outils générique que personne n'utilise.

## Ce qui n'y est pas

**Plus rien au-dessus de la barre.** La mesure du 12 septembre 2026 ne désigne
aucun motif restant qui soit à la fois répété et non couvert. Le prochain
module viendra d'un portage réel ou d'un produit qui en aura besoin — pas
d'une intuition.

Sous la barre, et assumés comme tels : la construction de menu (7 occurrences,
3 projets), l'extraction d'un identifiant Drive depuis une URL collée (3, 1
seul projet), et les trois familles mesurées le 12 septembre 2026 —
**l'impression** (le bloc `@media print` de `SocleStyle` la couvre ; la
génération de PDF n'apparaît qu'une fois, dans un seul projet), **l'import**
(zéro `parseCsv`, deux dépôts de fichier) et **l'export** (concentré dans un
seul projet : 4 téléchargements navigateur, 1 création de classeur).

Ce qui les ferait entrer : un produit qui en a besoin. Les deux suivants —
comptes rendus de réunion, veille contractuelle — liront des PDF et
produiront des rapports. Mais écrire un module pour un produit qui n'existe pas
encore, c'est en deviner la forme : c'est exactement ainsi que naissent les
boîtes à outils génériques.

## Licence

Elastic License 2.0 — Copyright Fabrice Faucheux (https://faucheux.bzh).

---

<a id="english"></a>

# Apps Script foundation modules

🇬🇧 English (below) · [📖 Version française](#francais)

Four modules to copy into an Apps Script project, so that normalising a date,
escaping HTML, reading a tab by header or replaying a transient error is
written once — and, more importantly, not written *differently* in every tool.
Code and comments are in French.

## What prompted it

Measured across six projects, 17,400 lines of `.gs`: date normalisation
existed in five versions that disagreed (three output formats, one hard-coded
timezone, one parsing `01/02/2026` as 2 January), HTML escaping in four
versions of which one covered three characters instead of five, and the two
best pieces — transient-error triage and HTTP backoff — each existed in
exactly one project, never together.

## Copied files, not an Apps Script library

A real library propagates a fix without touching the projects, which is a real
advantage. Against it: Google documents that *"a script that uses a library
doesn't run as quickly as it would if all the code were contained within a
single script project"* — which matters under a six-minute ceiling — and that
you cannot set breakpoints inside library code. Each host must also track a
deployment version, so a fix reaches nowhere until the library is republished
**and** every host repointed.

One point remains **unverified**: whether a library's OAuth scopes are added to
the calling script's. If they are, a single shared library would impose the
union of every scope on every project, which would settle the question the
other way. Worth checking before revisiting this choice.

The cost of copying is that copies drift — hence `outils/etat.js`, which makes
the drift visible instead of denying it.

## The modules

Each copies on its own; **none depends on another**, and the bench proves it by
loading each module in a sandbox where it alone exists.

- **`SocleDates.gs`** — normalise on read, never on write. Two formats:
  `yyyy-MM-dd` to store (the only one that sorts as text), "6 septembre 2026"
  to read. It never guesses: anything but ISO or `dd/MM/yyyy` returns `''`.
- **`SocleTexte.gs`** — five replacements, `&` first; plus `urlSure`, which
  filters the scheme, because `javascript:alert(1)` has nothing to escape.
- **`SocleFeuilles.gs`** — columns by header, batch writes, never overwrite a
  human decision. Writing creates a missing tab; reading does not.
- **`SocleReprises.gs`** — triage is worth more than the retry. Never a silent
  fallback value: the function rethrows, so the caller can report the failure.

## Tools

```bash
node banc/test.js      # 78 assertions, outside Google
node outils/etat.js    # which modules each project embeds, and what still awaits migration
```

## Licence

Elastic License 2.0 — Copyright Fabrice Faucheux (https://faucheux.bzh).
