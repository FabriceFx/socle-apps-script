// Banc d'essai du socle — se lance hors de Google :
//
//     node banc/test.js
//
// Deux invariants précèdent tous les autres, parce qu'ils décident si le
// socle est utilisable :
//
//   - **chaque module se charge seul.** Un module qui, sans le dire, appelle
//     une fonction d'un autre module ne se recopie plus indépendamment, et
//     l'on retombe sur ce qu'on voulait fuir. Chaque module est donc chargé
//     dans un bac à sable où lui seul existe ;
//   - **aucun nom de portée globale n'est déclaré deux fois.** Deux constantes
//     globales de même nom empêchent le projet hôte **entier** de se charger :
//     toutes ses fonctions deviennent introuvables d'un coup, y compris celles
//     qui n'ont rien à voir avec le socle.

// Chez Google, l'heure locale d'un script est celle du fuseau de
// appsscript.json, que le faux Session annonce : Europe/Paris. Node prend,
// lui, celui de la machine — juste sur un Mac réglé sur Paris, faux sur la CI
// en UTC, où une chaîne sans fuseau se lisait deux heures plus tard. Le banc
// impose donc le fuseau du script, avant toute création de Date.
process.env.TZ = 'Europe/Paris';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const DOSSIER = path.join(RACINE, 'modules');
const MODULES = fs.readdirSync(DOSSIER).filter((n) => n.endsWith('.gs')).sort();

let passes = 0;
const echecs = [];
let courante = '';
const sectionsJouees = [];
/**
 * Chaque section s'enregistre en démarrant.
 *
 * Sans cela, une section peut cesser de s'exécuter sans que rien ne le dise —
 * c'est arrivé : un `return` au niveau du module sortait du module et sautait
 * tout ce qui suivait, pendant que le banc annonçait « 0 échec ». Un banc qui
 * se déclare vert en ayant sauté un quart de son travail est pire qu'un banc
 * rouge.
 */
const section = (titre) => {
  courante = titre;
  sectionsJouees.push(titre);
  console.log(`\n— ${titre}`);
};
const verifier = (condition, message) => {
  if (condition) { passes += 1; return; }
  echecs.push(`${courante} · ${message}`);
  console.log(`  ÉCHEC : ${message}`);
};
const egal = (obtenu, attendu, message) => verifier(
  JSON.stringify(obtenu) === JSON.stringify(attendu),
  `${message} — attendu ${JSON.stringify(attendu)}, obtenu ${JSON.stringify(obtenu)}`);
const leve = (fonction, motif, message) => {
  try {
    fonction();
    verifier(false, `${message} — aucune exception levée`);
  } catch (erreur) {
    verifier(motif.test(String(erreur.message || erreur)),
      `${message} — message inattendu : ${erreur.message || erreur}`);
  }
};

// ---------------------------------------------------------------------------
// Faux services
// ---------------------------------------------------------------------------

const DATE_LISIBLE_ = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;

/** Promesses des sections asynchrones, attendues avant de conclure. */
const enAttente = [];

const monter = (fichiers = MODULES, options = {}) => {
  const trace = { setValues: 0, sleeps: [], fetchs: [] };

  class FauxFeuille {
    constructor(nom) {
      this.nom = nom; this.cellules = []; this.gras = {}; this.figees = 0;
      this.validations = {};
    }
    getName() { return this.nom; }
    getLastRow() { return this.cellules.length; }
    getLastColumn() {
      return this.cellules.reduce((m, r) => Math.max(m, r ? r.length : 0), 0);
    }
    getRange(ligne, colonne, hauteur = 1, largeur = 1) {
      if (![ligne, colonne, hauteur, largeur].every((n) => Number.isInteger(n) && n >= 1)) {
        throw new Error('The number of rows or columns in the range must be at least 1.');
      }
      const f = this;
      return {
        setValues(valeurs) {
          if (valeurs.length !== hauteur) {
            throw new Error('The number of rows in the data does not match the range.');
          }
          trace.setValues += 1;
          valeurs.forEach((rang, i) => {
            const cible = ligne + i - 1;
            f.cellules[cible] = f.cellules[cible] || [];
            rang.forEach((v, j) => {
              // Comme Sheets : une chaîne de date stockée ressort en objet Date.
              f.cellules[cible][colonne + j - 1] = (typeof v === 'string' && DATE_LISIBLE_.test(v))
                ? new Date(`${v.replace(' ', 'T')}+02:00`) : v;
            });
          });
          return this;
        },
        getValues() {
          const sortie = [];
          for (let i = 0; i < hauteur; i += 1) {
            const rang = f.cellules[ligne + i - 1] || [];
            const ligneLue = [];
            for (let j = 0; j < largeur; j += 1) {
              const v = rang[colonne + j - 1];
              ligneLue.push(v === undefined ? '' : v);
            }
            sortie.push(ligneLue);
          }
          return sortie;
        },
        setValue(v) { return this.setValues([[v]]); },
        getValue() { return this.getValues()[0][0]; },
        setFontWeight(p) { f.gras[`${ligne}:${colonne}`] = p; return this; },
        setDataValidation(regle) {
          for (let i = 0; i < hauteur; i += 1) {
            f.validations[`${ligne + i}:${colonne}`] = regle;
          }
          return this;
        },
      };
    }
    clear() { this.cellules = []; return this; }
    setFrozenRows(n) { this.figees = n; return this; }
  }

  class FauxClasseur {
    constructor() { this.feuilles = []; }
    getSheetByName(nom) { return this.feuilles.find((f) => f.nom === nom) || null; }
    getSheets() { return this.feuilles.slice(); }
    deleteSheet(feuille) {
      // Le vrai service refuse de supprimer la dernière feuille d'un classeur.
      if (this.feuilles.length <= 1) {
        throw new Error('You can\'t remove all the sheets in a document.');
      }
      this.feuilles = this.feuilles.filter((f) => f !== feuille);
    }
    insertSheet(nom) {
      if (this.getSheetByName(nom)) throw new Error(`A sheet named "${nom}" already exists.`);
      const f = new FauxFeuille(nom);
      this.feuilles.push(f);
      return f;
    }
  }

  const classeur = new FauxClasseur();

  const formater = (date, fuseau, format) => {
    const p = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date).forEach((x) => { p[x.type] = x.value; });
    // Le vrai formatDate suit la LOCALE DU SCRIPT pour les noms de mois, pas
    // la langue demandée. Le faux rend donc de l'anglais : un module qui s'en
    // servirait pour afficher « septembre » se ferait prendre ici.
    const moisAnglais = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'];
    return format
      .replace('MMMM', moisAnglais[Number(p.month) - 1])
      .replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
      .replace('HH', p.hour === '24' ? '00' : p.hour)
      .replace('mm', p.minute).replace('ss', p.second);
  };

  // Horloge que le banc fait avancer : l'anti-répétition ne se teste pas en
  // attendant six heures.
  const horloge = { ms: Date.parse('2026-09-12T09:00:00+02:00') };
  class FauxDate extends Date {
    constructor(...args) { if (args.length === 0) super(horloge.ms); else super(...args); }
    static now() { return horloge.ms; }
  }

  // Trois magasins bien distincts : c'est exactement ce que le vrai service
  // offre, et ce qu'un faux à un seul magasin masquerait — un jeton rangé
  // dans le magasin partagé y paraîtrait aussi isolé que dans celui de la
  // personne.
  const proprietes = {};
  const proprietesDocument = {};
  const proprietesPersonne = {};
  const magasin = (contenu) => ({
    getProperty: (c) => (c in contenu ? contenu[c] : null),
    setProperty(c, v) {
      // Le vrai service refuse au-delà de 9 Ko par valeur.
      if (String(v).length > 9216) throw new Error('Argument too large: value');
      contenu[c] = String(v);
      return this;
    },
    deleteProperty(c) { delete contenu[c]; return this; },
    getKeys: () => Object.keys(contenu),
  });

  // **Sans document, Google rend `null` — il ne lève pas.** C'est ce que le
  // premier essai réel a montré, et ce que ce faux service rendait à tort :
  // il validait un code qui plantait en production sur « Cannot read
  // properties of null ».
  const avecDocument = options.documentAccessible !== false;
  const PropertiesService = {
    getScriptProperties: () => magasin(proprietes),
    getDocumentProperties: () => (avecDocument ? magasin(proprietesDocument) : null),
    getUserProperties: () => magasin(proprietesPersonne),
  };

  const courrier = { envois: [], quota: options.quota === undefined ? 100 : options.quota };
  const MailApp = {
    sendEmail(parametres) {
      if (!parametres || !parametres.to) throw new Error('Failed to send email: no recipient');
      if (!parametres.subject) throw new Error('Failed to send email: no subject');
      courrier.envois.push(parametres);
      courrier.quota -= 1;
      return this;
    },
    getRemainingDailyQuota: () => courrier.quota,
  };

  const journalErreurs = [];

  class FausseSortieHtml {
    constructor(contenu) { this.contenu = contenu; this.metas = {}; }
    setTitle(t) { this.titre = t; return this; }
    addMetaTag(nom, valeur) { this.metas[nom] = valeur; return this; }
    setXFrameOptionsMode(mode) {
      // Le vrai service refuse un mode inconnu. L'énumération ne comporte que
      // ALLOWALL et DEFAULT : un DENY écrit de mémoire vaut undefined, et
      // c'est exactement ce qu'un faux complaisant laisserait passer.
      if (mode !== 'ALLOWALL' && mode !== 'DEFAULT') {
        throw new Error('The parameters (undefined) don\'t match the method signature '
          + 'for HtmlService.HtmlOutput.setXFrameOptionsMode.');
      }
      this.modeCadre = mode;
      return this;
    }
    getContent() { return this.contenu; }
  }

  const fichiersHtml = options.fichiersHtml || { SocleStyle: '<style>/* … */</style>' };
  const HtmlService = {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
    createHtmlOutputFromFile(nom) {
      if (!(nom in fichiersHtml)) {
        throw new Error(`No HTML file named ${nom} was found.`);
      }
      return new FausseSortieHtml(fichiersHtml[nom]);
    },
    createTemplateFromFile(nom) {
      if (!(nom in fichiersHtml)) {
        throw new Error(`No HTML file named ${nom} was found.`);
      }
      const modele = { evaluate: () => new FausseSortieHtml(fichiersHtml[nom]) };
      return modele;
    },
  };

  const etatVerrou = { pris: false };
  const fauxVerrou = () => ({
    tryLock() { if (etatVerrou.pris) return false; etatVerrou.pris = true; return true; },
    releaseLock() { etatVerrou.pris = false; },
  });
  const LockService = {
    // Même piège que les propriétés : sans document, `getDocumentLock()` rend
    // `null`. Le faux le rendait toujours, et validait donc un code qui
    // plantait dans un projet autonome.
    getDocumentLock: () => (options.documentAccessible === false ? null : fauxVerrou()),
    getScriptLock: () => fauxVerrou(),
  };

  const declencheurs = options.declencheurs || [];
  const ScriptApp = {
    newTrigger(nom) {
      if (typeof nom !== 'string' || nom.trim() === '') {
        throw new Error('The function name cannot be null or empty.');
      }
      const pose = { nom };
      return {
        timeBased: () => ({
          after(ms) {
            if (!Number.isFinite(ms) || ms <= 0) {
              throw new Error('Invalid argument: durationMilliseconds');
            }
            pose.apres = ms;
            return { create() { declencheurs.push(pose); return pose; } };
          },
        }),
      };
    },
    getProjectTriggers: () => declencheurs.map((pose) => ({
      getHandlerFunction: () => pose.nom, _pose: pose,
    })),
    deleteTrigger(handle) {
      const i = declencheurs.indexOf(handle._pose);
      if (i >= 0) declencheurs.splice(i, 1);
    },
  };

  const sandbox = {
    LockService,
    ScriptApp,
    HtmlService,
    PropertiesService,
    MailApp,
    Date: FauxDate,
    SpreadsheetApp: {
      getActive: () => classeur,
      newDataValidation: () => {
        const regle = { valeurs: null, bloquant: null, aide: '', min: null, max: null };
        const bati = {
          requireValueInList(v, deroulant) {
            // Le vrai service refuse une liste vide : un faux complaisant
            // poserait une liste déroulante sans rien dedans.
            if (!Array.isArray(v) || v.length === 0) {
              throw new Error('The parameters (null) don\'t match requireValueInList.');
            }
            regle.valeurs = v;
            regle.deroulant = deroulant !== false;
            return bati;
          },
          requireNumberBetween(a, b) { regle.min = a; regle.max = b; return bati; },
          setAllowInvalid(x) { regle.bloquant = x === false; return bati; },
          setHelpText(t) { regle.aide = t; return bati; },
          build: () => regle,
        };
        return bati;
      },
    },
    Session: { getScriptTimeZone: () => 'Europe/Paris' },
    Utilities: {
      formatDate(date, fuseau, format) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
          throw new Error(
            'The parameters (null,String,String) don\'t match the method signature '
            + 'for Utilities.formatDate.');
        }
        return formater(date, fuseau, format);
      },
      sleep(ms) { trace.sleeps.push(ms); },
    },
    UrlFetchApp: {
      reponses: [],
      fetch(url, options) {
        trace.fetchs.push({ url, options });
        const prochaine = this.reponses.shift();
        if (!prochaine) throw new Error('Faux UrlFetchApp : aucune réponse programmée.');
        return {
          getResponseCode: () => prochaine.code,
          getContentText: () => prochaine.corps || '',
        };
      },
    },
    console: { log: () => {}, error: (m) => journalErreurs.push(String(m)), warn: () => {} },
    JSON, Math, Number, String, Object, Array, Boolean, RegExp, Error, Intl,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  fichiers.forEach((nom) => {
    vm.runInContext(fs.readFileSync(path.join(DOSSIER, nom), 'utf8'), sandbox, { filename: nom });
  });

  return {
    sandbox, classeur, trace, courrier, proprietes, proprietesDocument,
    proprietesPersonne, horloge, journalErreurs,
    declencheurs, etatVerrou,
    avancer: (ms) => { horloge.ms += ms; },
    lire: (e) => vm.runInContext(e, sandbox),
    executer: (code) => vm.runInContext(code, sandbox),
  };
};

// ---------------------------------------------------------------------------

section('A. Le socle comme ensemble');
{
  const version = fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim();

  // Chaque module, seul dans son bac à sable.
  MODULES.forEach((nom) => {
    let contexte = null;
    try {
      contexte = monter([nom]);
    } catch (erreur) {
      verifier(false, `${nom} ne se charge pas seul : ${erreur.message}`);
      return;
    }
    const objet = nom.replace('.gs', '');
    const chargé = contexte.lire(`typeof ${objet} === 'object'`);
    verifier(chargé, `${nom} se charge seul et publie ${objet}`);
    if (chargé) {
      egal(contexte.lire(`${objet}.version`), version,
        `${objet}.version vaut le fichier VERSION`);
    }
  });

  // Le préparateur du dossier d'essai écrit un Menu.gs. Ses points d'entrée
  // doivent être des `function` déclarées — un menu résout sa cible par son
  // nom global, et une const fléchée y serait introuvable.
  const preparateur = fs.readFileSync(path.join(RACINE, 'outils', 'preparer-essai.js'), 'utf8');
  const menu = (/const MENU = `([\s\S]*?)\n`;/.exec(preparateur) || [])[1] || '';
  const cibles = [...menu.matchAll(/addItem\('[^']*',\s*'([^']+)'\)/g)].map((m) => m[1]);
  const declarees = new Set([...menu.matchAll(/^function\s+(\w+)/gm)].map((m) => m[1]));
  egal(cibles.filter((c) => !declarees.has(c)), [],
    'le menu du classeur d’essai ne vise que des « function » déclarées');
  verifier(declarees.has('onOpen'),
    'et il pose onOpen, le déclencheur simple qui n’a rien à installer');

  // Les outils portent la version du socle eux aussi. Le contrôle ne portait
  // que sur `modules/`, et la version de SocleControle a dérivé dès le
  // lendemain de son écriture : une version affichée et fausse est pire que
  // pas de version, puisqu'elle sert justement à savoir ce qui tourne.
  fs.readdirSync(path.join(RACINE, 'outils'))
    .filter((nom) => nom.endsWith('.gs'))
    .forEach((nom) => {
      const source = fs.readFileSync(path.join(RACINE, 'outils', nom), 'utf8');
      const declaree = (/^const \w*_VERSION_ = '([^']+)';/m.exec(source) || [])[1];
      if (declaree === undefined) return;   // un outil peut n'en porter aucune
      egal(declaree, version, `outils/${nom} porte la version du socle`);
    });

  // Aucun nom global déclaré deux fois entre modules.
  const declarations = new Map();
  const collisions = [];
  MODULES.forEach((nom) => {
    fs.readFileSync(path.join(DOSSIER, nom), 'utf8').split('\n').forEach((ligne) => {
      const trouve = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)|^function\s+([A-Za-z_$][\w$]*)/
        .exec(ligne);
      if (!trouve) return;
      const id = trouve[1] || trouve[2];
      if (declarations.has(id)) collisions.push(`${id} (${declarations.get(id)} et ${nom})`);
      declarations.set(id, nom);
    });
  });
  egal(collisions, [], 'aucun nom de portée globale déclaré deux fois entre modules');

  // Aucun module n'appelle un autre module du socle.
  const publics = MODULES.map((n) => n.replace('.gs', ''));
  MODULES.forEach((nom) => {
    const source = fs.readFileSync(path.join(DOSSIER, nom), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');   // hors commentaires
    const autres = publics.filter((p) => p !== nom.replace('.gs', '') && source.includes(`${p}.`));
    egal(autres, [], `${nom} ne dépend d'aucun autre module`);
  });
}

section('A bis. Les messages du socle disent quoi faire');
{
  // La mesure du 12 septembre 2026 sur six projets : 118 exceptions levées,
  // dont 9 disaient quoi faire ensuite — et le socle était à 0 sur 12. Une
  // règle qu'on écrit sans la faire respecter n'est pas une règle, c'est un
  // vœu. Ce contrôle la rend applicable au socle lui-même.
  const IMPERATIF = /(?:^|[.:;»\n]\s*|\b(?:puis|et|ou)\s+)[A-ZÉÀÇ][a-zéèêàçûîôA-Z]{2,}ez\b/;
  const sans = [];
  MODULES.forEach((nom) => {
    const source = fs.readFileSync(path.join(DOSSIER, nom), 'utf8');
    [...source.matchAll(/throw new Error\(\s*((?:`[^`]*`|'(?:\\.|[^'])*')(?:\s*\+\s*(?:`[^`]*`|'(?:\\.|[^'])*'))*)/g)]
      .forEach((m) => {
        // Le message tel qu'il sera lu, et non tel qu'il est écrit : la
        // concaténation JavaScript coupe les phrases en deux et masquerait
        // l'impératif qui suit un « ' + ' ».
        const phrase = m[1]
          .replace(/['"`]\s*\+\s*['"`]/g, '')
          .replace(/^['"`]|['"`]$/g, '');
        if (IMPERATIF.test(phrase)) return;
        // Convention du socle : une interpolation nommée « remede » porte le
        // remède, choisi selon le cas. C'est la seule échappatoire, et elle a
        // un nom pour ne pas devenir une porte ouverte.
        if (/\$\{remede\}/.test(phrase)) return;
        sans.push(`${nom} — ${phrase.replace(/\s+/g, ' ').slice(0, 72)}…`);
      });
  });
  egal(sans, [], 'tout message levé par le socle dit quoi faire ensuite');
}

section('A ter. L’outil de contrôle');
{
  // SocleControle ne se teste pas ici — c'est lui qui teste ce que Node ne
  // peut pas voir. Mais il vit dans le même projet Apps Script que les
  // modules, et une collision de nom global y empêcherait le projet ENTIER de
  // se charger. Ça, le banc peut le vérifier.
  // Le piège qui a fait échouer la première version de SocleControle, en
  // production, au premier essai : **une `const` de portée globale ne devient
  // jamais une propriété de l'objet global**. Le bac à sable le reproduit
  // fidèlement — encore fallait-il l'éprouver.
  const bac = monter(['SocleDates.gs']);
  verifier(bac.lire("typeof SocleDates") === 'object',
    'un module se trouve par son nom, en recherche lexicale');
  verifier(bac.lire("typeof globalThis.SocleDates") === 'undefined',
    'mais JAMAIS sur globalThis : une const globale n’y figure pas, et un détecteur '
    + 'qui l’y cherche déclare « absent » un module parfaitement chargé');
  verifier(bac.lire("(function () { return typeof SocleInexistant; }())") === 'undefined',
    'typeof est le seul opérateur qui ne lève pas sur un identifiant jamais déclaré — '
    + 'c’est ce qui rend la table de détection utilisable sur un socle partiel');

  const outil = fs.readFileSync(path.join(RACINE, 'outils', 'SocleControle.gs'), 'utf8');
  try {
    new vm.Script(outil, { filename: 'SocleControle.gs' });
    verifier(true, 'SocleControle.gs est syntaxiquement valide');
  } catch (erreur) {
    verifier(false, `syntaxe de SocleControle.gs : ${erreur.message}`);
  }

  verifier(/^function controlerLeSocle\(\)/m.test(outil),
    'son point d’entrée est une « function » déclarée — sinon l’éditeur ne le proposerait '
    + 'pas au menu d’exécution, et il serait inlançable');

  const nomsOutil = [...outil.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)]
    .map((m) => m[1]);
  const nomsModules = MODULES.flatMap((nom) => [...fs
    .readFileSync(path.join(DOSSIER, nom), 'utf8')
    .matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]));
  egal(nomsOutil.filter((n) => nomsModules.includes(n)), [],
    'et aucun de ses noms globaux n’entre en collision avec un module');

  // Il ne doit envoyer aucun courriel : c'est un contrôle, pas une démonstration.
  const codeNu = outil.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  verifier(!/globalThis\[/.test(codeNu),
    'il ne cherche aucun module sur globalThis — c’est le défaut qui l’a rendu inopérant '
    + 'au premier essai, et il ne doit pas revenir par commodité');
  verifier(!/sendEmail|SocleCourriel\.(information|question)\(/.test(codeNu),
    'il n’envoie aucun courriel — seuls les refus, qui lèvent avant d’envoyer, sont éprouvés');
}

section('B. Dates');
{
  const contexte = monter(['SocleDates.gs']);
  const { lire } = contexte;
  const D = lire('SocleDates');

  // Les dates se construisent avec le Date DU BAC À SABLE : une Date créée
  // au-dehors n'en est pas une instance, et `valeur instanceof Date` serait
  // faux à l'intérieur. Le même piège existe entre deux contextes d'exécution
  // réels — c'est pour cela que le module ne se fie jamais à `typeof`.
  const D8 = contexte.sandbox.Date;

  egal(D.jour(new D8(2026, 8, 6)), '2026-09-06', 'un objet Date rend le format de stockage');
  verifier(!/^[A-Za-z]{3} /.test(D.jour(new D8(2026, 8, 6))),
    'jamais « Sat Sep 06 2026 » — qui se trierait sur le nom du jour');
  egal(D.jour('2026-09-06T14:05:00.000Z'), '2026-09-06', 'une chaîne ISO est acceptée');

  // Le fuseau d'une chaîne ISO se respecte. Les API Google horodatent en UTC :
  // lire « 23:30Z » comme 23:30 locales décale d'un jour tout un rapport, dans
  // une colonne faite pour être triée. Trouvé en portant l'assistant des
  // procédures, pas au banc du socle.
  egal(D.horodatage('2026-09-01T10:00:00.000Z'), '2026-09-01 12:00:00',
    'un horodatage UTC est ramené à l’heure du script (Paris, +2 en septembre)');
  egal(D.jour('2026-09-06T23:30:00.000Z'), '2026-09-07',
    'et près de minuit, cela change le JOUR — c’est tout l’enjeu');
  egal(D.horodatage('2026-09-01T10:00:00+02:00'), '2026-09-01 10:00:00',
    'un décalage explicite est respecté lui aussi');
  egal(D.horodatage('2026-09-01 10:00:00'), '2026-09-01 10:00:00',
    'une chaîne sans fuseau reste locale : c’est ce que Sheets rend d’une cellule');
  egal(D.jour('01/02/2026'), '2026-02-01',
    'jj/mm/aaaa est lu à la française — 1er février, et non 2 janvier');
  egal(D.jour(45000), '', 'un nombre est refusé plutôt que lu comme un numéro de série');
  egal(D.jour('la semaine prochaine'), '', 'ce qui ne se lit pas rend « non mesuré »');
  egal(D.jour(''), '', 'une cellule vide rend une chaîne vide');
  egal(D.jour(null), '', 'null aussi');

  egal(D.horodatage(new D8(2026, 8, 6, 14, 5, 9)), '2026-09-06 14:05:09',
    'l’horodatage de stockage se trie lui aussi');

  egal(D.lisible('2026-09-06'), '6 septembre 2026', 'le format de lecture est en français');
  egal(D.lisible('2026-09-01'), '1er septembre 2026', 'le premier du mois prend son ordinal');
  egal(D.lisible('2026-09-06', 'en'), 'September 6, 2026', 'et l’anglais suit sa propre forme');
  egal(D.lisibleAvecHeure('2026-09-06 14:05:00'), '6 septembre 2026 à 14:05',
    'avec l’heure quand on la demande');

  verifier(D.estJour('2026-09-06') && !D.estJour('06/09/2026'),
    'estJour reconnaît le format de stockage, et lui seul');

  // Le passage à l'heure d'été : 24 h ne font pas toujours un jour.
  egal(D.ecartEnJours('2026-03-28', '2026-03-29'), 1,
    'un jour reste un jour malgré le changement d’heure');
  egal(D.ecartEnJours('2026-09-06', '2026-12-06'), 91, 'et l’écart se compte en jours entiers');
  egal(D.ecartEnJours('2026-09-06', 'illisible'), null,
    'un écart qu’on ne peut pas calculer rend null, jamais 0');
}

section('C. Texte');
{
  const { lire } = monter(['SocleTexte.gs']);
  const T = lire('SocleTexte');

  egal(T.echapperHtml('<a href="x" title=\'y\'>a & b</a>'),
    '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;a &amp; b&lt;/a&gt;',
    'les cinq remplacements, guillemets des deux sortes compris');
  egal(T.echapperHtml('&lt;'), '&amp;lt;',
    'l’esperluette est traitée en premier, sinon les entités seraient ré-échappées');
  egal(T.echapperHtml(null), '', 'null rend une chaîne vide, pas « null »');

  egal(T.urlSure('javascript:alert(1)'), '',
    'un schéma exécutable est refusé — échapper ne suffit pas, il n’y a rien à échapper');
  egal(T.urlSure('https://faucheux.bzh/a?b=1&c=2'), 'https://faucheux.bzh/a?b=1&amp;c=2',
    'une URL http est gardée et échappée');
  egal(T.urlSure('mailto:x@y.fr'), 'mailto:x@y.fr', 'mailto est autorisé');
  egal(T.urlSure('/page/interne'), '/page/interne', 'une URL relative passe');

  egal(T.tronquer('abcdef', 10), 'abcdef', 'un texte court n’est pas touché');
  verifier(T.tronquer('un texte nettement trop long pour la place', 20).endsWith('…'),
    'un texte tronqué le dit');
  verifier(T.tronquer('un texte nettement trop long pour la place', 20).length <= 20,
    'et il tient dans la place demandée');

  egal(T.comparable('  Élève   ÉCOLE '), 'eleve ecole',
    'la comparaison humaine ignore accents, casse et blancs — sans dépendre d’ICU');
  egal(T.normaliserEspaces(' a   b '), 'a b', 'les blancs successifs se réduisent');
}

section('D. Feuilles');
{
  const contexte = monter(['SocleFeuilles.gs']);
  const F = contexte.lire('SocleFeuilles');

  const premier = F.onglet('Données');
  egal(premier.cree, true, 'un onglet absent est créé, et l’appelant le sait');
  egal(F.onglet('Données').cree, false, 'un onglet déjà là n’est pas recréé');

  F.ecrireTable('Données', ['Nom', 'Service', 'Arrivée'], [
    { Nom: 'Alice', Service: 'RH', 'Arrivée': '2026-01-05' },
    { Nom: 'Bruno', Service: 'IT', 'Arrivée': '2026-03-11' },
  ]);
  const avant = contexte.trace.setValues;
  const table = F.lireTable('Données');
  egal(contexte.trace.setValues, avant, 'lire n’écrit rien');
  egal(table.lignes.length, 2, 'les lignes sont lues');
  egal(table.lignes[0].Nom, 'Alice', 'et indexées par nom de colonne');
  egal(table.lignes[1].numero, 3, 'chaque ligne porte son numéro dans l’onglet');
  verifier(table.lignes[0]['Arrivée'] instanceof Date,
    'une date ressort en objet Date, comme chez Sheets — à l’appelant de normaliser');

  egal(F.colonne(table, 'Service'), 1, 'une colonne se retrouve par son nom');
  leve(() => F.colonne(table, 'Matricule'), /Colonnes présentes : Nom, Service, Arrivée/,
    'une colonne absente lève en disant lesquelles existent');

  // Une colonne insérée par un utilisateur ne décale rien.
  contexte.classeur.getSheetByName('Données').getRange(1, 4).setValue('Commentaire');
  contexte.classeur.getSheetByName('Données').getRange(2, 4).setValue('à revoir');
  const apres = F.lireTable('Données');
  egal(apres.lignes[0].Nom, 'Alice', 'l’ajout d’une colonne ne décale pas les autres');
  egal(apres.lignes[0].Commentaire, 'à revoir', 'et la nouvelle colonne est lue');

  egal(F.completerColonnes('Données', ['Service', 'Matricule']).ajoutees, ['Matricule'],
    'completerColonnes n’ajoute que ce qui manque');

  // Réglages : par clé, jamais par numéro de ligne.
  egal(F.lireReglages('Réglages'), {}, 'un onglet de réglages absent rend un objet vide sans lever');
  F.ecrireTable('Réglages', ['Réglage', 'Valeur'], [['Langue', 'Français'], ['Heure', '6']]);
  egal(F.lireReglages('Réglages'), { Langue: 'Français', Heure: '6' }, 'les réglages se lisent par clé');

  // Une ligne insérée à la main décale tout : l'écriture par clé doit y survivre.
  const feuilleReglages = contexte.classeur.getSheetByName('Réglages');
  feuilleReglages.cellules.splice(1, 0, ['Note ajoutée à la main', '']);
  F.ecrireReglage('Réglages', 'Heure', '7');
  egal(F.lireReglages('Réglages').Heure, '7',
    'un réglage s’écrit par sa clé, malgré une ligne insérée au-dessus');
  egal(F.lireReglages('Réglages').Langue, 'Français', 'sans toucher aux autres');

  egal(F.ecrireReglage('Réglages', 'Nouveau', 'x').ajoutee, true,
    'une clé absente est ajoutée à la fin');

  const complete = F.completerReglages('Réglages', { Langue: 'English', Absent: 'défaut' });
  egal(complete.poses, ['Absent'], 'compléter ne pose que ce qui manque');
  egal(F.lireReglages('Réglages').Langue, 'Français',
    'et ne réécrit jamais une décision humaine déjà prise');

  // Listes déroulantes et intervalles, posés sur un réglage trouvé par sa clé.
  const listes = monter(['SocleFeuilles.gs']);
  const FL = listes.lire('SocleFeuilles');
  FL.ecrireTable('Réglages', ['Réglage', 'Valeur'], [
    ['Langue', 'Français'], ['Heure', '6'], ['Modèle', 'gemini-2.5-flash'],
  ]);

  const pose = FL.listeSurReglage('Réglages', 'Modèle', ['a', 'b', 'c']);
  egal(pose.ligne, 4, 'la liste est posée sur la ligne du réglage, trouvée par sa clé');
  const reglagesListes = listes.classeur.getSheetByName('Réglages');
  egal(reglagesListes.validations['4:2'].valeurs, ['a', 'b', 'c'],
    'et porte les valeurs proposées');
  egal(reglagesListes.validations['4:2'].bloquant, false,
    'sans bloquer par défaut : une liste tirée d’une API peut dater, et un nom '
    + 'valide apparu depuis ne doit pas être refusé');

  FL.listeSurReglage('Réglages', 'Langue', ['Français', 'English'], { bloquant: true });
  egal(reglagesListes.validations['2:2'].bloquant, true,
    'un ensemble fermé, lui, se bloque');

  // Une ligne insérée au-dessus ne doit pas déplacer la validation.
  reglagesListes.cellules.splice(1, 0, ['Note ajoutée à la main', '']);
  FL.listeSurReglage('Réglages', 'Modèle', ['x', 'y']);
  egal(reglagesListes.validations['5:2'].valeurs, ['x', 'y'],
    'la clé suit son réglage quand une ligne est insérée — jamais par position');

  // « Heure » a glissé en ligne 4 avec l'insertion : la clé la retrouve quand
  // même, et c'est tout l'objet de ces fonctions.
  FL.nombreSurReglage('Réglages', 'Heure', 0, 23);
  egal([reglagesListes.validations['4:2'].min, reglagesListes.validations['4:2'].max],
    [0, 23], 'un intervalle là où dérouler cent valeurs n’aiderait personne');
  egal(reglagesListes.validations['4:2'].bloquant, true,
    'et celui-là bloque : hors intervalle, il n’y a pas de doute');

  leve(() => FL.listeSurReglage('Réglages', 'Réglage inconnu', ['a']),
    /Aucun réglage nommé/,
    'poser une liste sur un réglage absent est refusé, en disant quoi vérifier');
  leve(() => FL.listeSurReglage('Réglages', 'Modèle', []),
    /don't match requireValueInList/,
    'et une liste vide est refusée par le service lui-même');

  // La feuille que Google pose dans un classeur neuf.
  const neuf = monter(['SocleFeuilles.gs']);
  neuf.classeur.insertSheet('Feuille 1');
  neuf.classeur.insertSheet('Données');
  egal(neuf.lire('SocleFeuilles').retirerFeuilleParDefaut().retirees, ['Feuille 1'],
    'la feuille par défaut, vide, est retirée — et l’appelant peut le dire');
  egal(neuf.classeur.getSheets().map((f) => f.nom), ['Données'],
    'et elle ne traîne plus dans le classeur');

  // Les deux gardes, qui comptent bien plus que la liste de noms.
  const habitee = monter(['SocleFeuilles.gs']);
  habitee.lire('SocleFeuilles').ecrireTable('Feuille 1', ['Notes'], [['à moi']]);
  habitee.classeur.insertSheet('Données');
  egal(habitee.lire('SocleFeuilles').retirerFeuilleParDefaut().retirees, [],
    'une feuille par défaut où quelqu’un a écrit n’est plus une feuille par défaut');

  const seule = monter(['SocleFeuilles.gs']);
  seule.classeur.insertSheet('Sheet1');
  egal(seule.lire('SocleFeuilles').retirerFeuilleParDefaut().retirees, [],
    'et la dernière feuille d’un classeur ne se supprime jamais : Sheets le refuse');

  const variantes = monter(['SocleFeuilles.gs']);
  ['Feuille1', 'Sheet 1', 'HOJA 1', 'Données'].forEach((n) => variantes.classeur.insertSheet(n));
  egal(variantes.lire('SocleFeuilles').retirerFeuilleParDefaut().retirees.sort(),
    ['Feuille1', 'HOJA 1', 'Sheet 1'],
    'les variantes d’écriture et de langue sont reconnues, casse comprise');

  // « Feuil1 » est le nom par défaut d'Excel en français : c'est celui d'un
  // classeur .xlsx importé dans Sheets.
  const excel = monter(['SocleFeuilles.gs']);
  ['Feuil1', 'Feuil 1', 'Données'].forEach((n) => excel.classeur.insertSheet(n));
  egal(excel.lire('SocleFeuilles').retirerFeuilleParDefaut().retirees.sort(),
    ['Feuil 1', 'Feuil1'],
    'le nom par défaut d’Excel, importé dans Sheets, est reconnu aussi');

  // Le piège du trombinoscope : présent mais vide n'est pas absent.
  contexte.classeur.insertSheet('Vide');
  F.ecrireTable('Vide', ['A', 'B'], []);
  egal(F.lireTable('Vide').entete, ['A', 'B'],
    'un onglet déjà présent mais vide reçoit quand même son en-tête');
}

section('E. Reprises');
{
  const contexte = monter(['SocleReprises.gs']);
  const R = contexte.lire('SocleReprises');

  verifier(R.estTransitoire(new Error('Rate Limit Exceeded')), 'une surcharge est transitoire');
  verifier(R.estTransitoire(new Error('Service invoked too many times')), 'un quota par minute aussi');
  verifier(!R.estTransitoire(new Error('You do not have permission to access')),
    'un refus de droits ne l’est pas — le rejouer quadruple le temps d’un échec certain');
  verifier(!R.estTransitoire(new Error('File not found')), 'ni un fichier introuvable');

  const appels = { compte: 0 };
  const valeur = R.avecReprises(() => {
    appels.compte += 1;
    if (appels.compte < 3) throw new Error('Internal error, try again');
    return 'abouti';
  });
  egal(valeur, 'abouti', 'une erreur passagère est absorbée');
  egal(appels.compte, 3, 'après le bon nombre de tentatives');
  // Les attentes doublent, avec jusqu'à 500 ms de dispersion : on vérifie donc
  // des intervalles, pas des valeurs. Sans dispersion, trois cents appels
  // lancés ensemble réessaieraient tous à la même seconde et reconstitueraient
  // la surcharge que la reprise est censée absorber.
  egal(contexte.trace.sleeps.length, 2, 'deux attentes pour trois tentatives');
  verifier(contexte.trace.sleeps[0] >= 800 && contexte.trace.sleeps[0] < 1300,
    `première attente dans [800, 1300) — obtenue ${contexte.trace.sleeps[0]}`);
  verifier(contexte.trace.sleeps[1] >= 1600 && contexte.trace.sleeps[1] < 2100,
    `seconde attente dans [1600, 2100) — obtenue ${contexte.trace.sleeps[1]}`);
  verifier(contexte.trace.sleeps[0] !== contexte.trace.sleeps[1],
    'et elles ne sont pas identiques : l’attente double bel et bien');

  // Le plafond : sans lui, une septième tentative attendrait une minute.
  const plafonne = monter(['SocleReprises.gs']);
  let coups = 0;
  try {
    plafonne.lire('SocleReprises').avecReprises(() => {
      coups += 1;
      throw new Error('backend error');
    }, { tentatives: 8, plafondMs: 3000 });
  } catch (e) { /* attendu */ }
  egal(coups, 8, 'huit tentatives demandées, huit tentatives faites');
  verifier(plafonne.trace.sleeps.every((ms) => ms < 3000 + 500),
    `aucune attente au-delà du plafond — obtenues ${plafonne.trace.sleeps.join(', ')}`);

  const definitifs = { compte: 0 };
  leve(() => R.avecReprises(() => {
    definitifs.compte += 1;
    throw new Error('You do not have permission');
  }), /do not have permission/, 'une erreur définitive remonte');
  egal(definitifs.compte, 1, 'et n’est jamais rejouée');

  leve(() => R.avecReprises(() => { throw new Error('backend error'); }), /backend error/,
    'les tentatives épuisées relèvent — jamais de valeur de repli silencieuse');

  // Couche HTTP.
  contexte.trace.fetchs.length = 0;
  contexte.sandbox.UrlFetchApp.reponses = [{ code: 429 }, { code: 200, corps: '{"ok":true}' }];
  const reponse = R.appelHttp('https://exemple.org/api?cle=secrete');
  egal(reponse.getResponseCode(), 200, 'un 429 est rejoué puis aboutit');
  egal(contexte.trace.fetchs.length, 2, 'en deux appels');
  egal(contexte.trace.fetchs[0].options.muteHttpExceptions, true,
    'muteHttpExceptions est imposé, sinon on perd le corps de la réponse');

  contexte.sandbox.UrlFetchApp.reponses = [{ code: 400, corps: '{"error":"champ manquant"}' }];
  leve(() => R.appelHttp('https://exemple.org/api'), /400.*champ manquant/,
    'un 400 lève avec le code ET le corps — « Erreur 400 » seul n’a jamais aidé personne');

  contexte.sandbox.UrlFetchApp.reponses = [{ code: 503 }, { code: 503 }, { code: 503 }];
  leve(() => R.appelHttp('https://exemple.org/api'), /après 3 tentatives/,
    'un 503 persistant le dit après avoir épuisé les tentatives');

  contexte.sandbox.UrlFetchApp.reponses = [{ code: 200 }];
  R.appelHttp('https://exemple.org/api', { muteHttpExceptions: false });
  egal(contexte.trace.fetchs[contexte.trace.fetchs.length - 1].options.muteHttpExceptions, true,
    'même si l’appelant tente de le désactiver');
}

section('F. Courriels');
{
  const contexte = monter(['SocleCourriel.gs']);
  const C = contexte.lire('SocleCourriel');
  const source = { outil: 'Audit des partages', version: '5.3.0', lien: 'https://exemple/x' };

  // Ce que le module refuse est l'essentiel : sans ces refus, il ne serait
  // qu'un habillage de MailApp.
  leve(() => C.information({ a: 'x@y.fr', corps: 'coucou' }), /doit porter un objet/,
    'une information sans objet est refusée');
  leve(() => C.erreur({ a: 'x@y.fr', quoi: 'Synchronisation échouée' }),
    /doit dire quoi faire ensuite/,
    'une erreur sans remède est refusée — « ce qui a échoué » n’apprend rien à qui le reçoit');
  leve(() => C.question({ a: 'x@y.fr', objet: 'Votre avis', question: 'On garde ?' }),
    /dire par où répondre/, 'une question sans canal de réponse est refusée');
  leve(() => C.question({
    a: 'x@y.fr', objet: 'Votre avis', question: 'On garde ?', repondreVia: 'https://form',
  }), /doit porter une échéance/,
    'une question sans échéance est refusée : personne ne saurait qu’elle est restée sans réponse');
  leve(() => C.information({ a: '', objet: 'x', corps: 'y' }), /Aucun destinataire/,
    'un envoi sans destinataire est refusé');

  // Les trois natures se distinguent dès l'objet, pour être filtrables sans
  // ouvrir le message.
  C.information({ a: 'admin@y.fr', objet: 'Génération terminée', corps: '42 lignes.', source });
  const info = contexte.courrier.envois[0];
  egal(info.subject, '[Info] Génération terminée', 'l’objet porte le marqueur de nature');
  verifier(info.body.includes('Audit des partages'), 'le pied dit d’où vient le message');
  verifier(info.body.includes('version 5.3.0'), 'et quelle version l’a envoyé');

  const erreur = C.erreur({
    a: 'admin@y.fr', cle: 'photos-inaccessibles',
    quoi: 'Le dossier des photos n’est plus lisible',
    quoiFaire: 'Repartagez le dossier avec ce compte, puis relancez la génération.',
    cause: 'DriveApp: Access denied (folder 1A2B)', source,
  });
  egal(erreur.envoye, true, 'la première occurrence d’une cause part');
  const corpsErreur = contexte.courrier.envois[1].body;
  verifier(corpsErreur.indexOf('À faire') < corpsErreur.indexOf('Détail technique'),
    'le remède vient avant le détail technique, pas l’inverse');

  // Anti-répétition : borné, et avoué.
  const deuxieme = C.erreur({
    a: 'admin@y.fr', cle: 'photos-inaccessibles', quoi: 'Le dossier des photos n’est plus lisible',
    quoiFaire: 'Repartagez le dossier.', source,
  });
  egal(deuxieme.envoye, false, 'la même cause ne repart pas dans la fenêtre de silence');
  egal(deuxieme.raison, 'silence', 'et le module dit pourquoi');
  egal(contexte.courrier.envois.length, 2, 'aucun message supplémentaire n’est parti');

  C.erreur({ a: 'admin@y.fr', cle: 'photos-inaccessibles', quoi: 'Idem', quoiFaire: 'Idem.' });
  contexte.avancer(7 * 60 * 60 * 1000);   // au-delà des six heures
  const reprise = C.erreur({
    a: 'admin@y.fr', cle: 'photos-inaccessibles',
    quoi: 'Le dossier des photos n’est plus lisible', quoiFaire: 'Repartagez le dossier.',
  });
  egal(reprise.envoye, true, 'passé le silence, la cause repart');
  verifier(contexte.courrier.envois[2].body.includes('survenue 3 fois'),
    'et le message dit combien de fois elle est survenue entre-temps — un silence '
    + 'qui cacherait le volume mentirait sur l’ampleur');

  // Une cause corrigée s'oublie, sans attendre la fin du silence.
  C.erreur({ a: 'admin@y.fr', cle: 'autre-cause', quoi: 'Autre', quoiFaire: 'Autre chose.' });
  egal(C.oublierCause('photos-inaccessibles').oubliees, 1, 'une cause s’oublie nommément');
  egal(C.oublierCause().oubliees, 1, 'et le reste s’oublie en bloc');

  const question = C.question({
    a: 'metier@y.fr', objet: 'Ce partage externe est-il voulu ?',
    question: 'Le fichier « Budget 2027 » est ouvert à contact@client.test.',
    repondreVia: 'https://forms.exemple/repondre',
    avantLe: '2026-09-30', source,
  });
  verifier(/^Question-\d+$/.test(question.reference),
    'une question rend une référence, que l’appelant consigne où vit son état');
  const corpsQuestion = contexte.courrier.envois[contexte.courrier.envois.length - 1].body;
  verifier(corpsQuestion.includes('Répondre : https://forms.exemple/repondre'),
    'le canal de réponse figure dans le message');
  verifier(corpsQuestion.includes('Avant le : 2026-09-30'), 'l’échéance aussi');

  // Le quota se lit avant, pas après.
  const vide = monter(['SocleCourriel.gs'], { quota: 0 });
  leve(() => vide.lire('SocleCourriel').information({ a: 'x@y.fr', objet: 'x', corps: 'y' }),
    /Quota d'envoi épuisé/,
    'un quota épuisé refuse avant d’envoyer, et dit qu’il faudra renvoyer demain');
  egal(vide.courrier.envois.length, 0, 'rien n’est parti');
}

section('E bis. Le plafond des six minutes');
{
  const contexte = monter(['SocleExecution.gs']);
  const X = contexte.lire('SocleExecution');

  const budget = X.budget({ msMax: 100 * 1000 });
  egal(budget.ecoule(), 0, 'un budget neuf n’a rien consommé');
  verifier(budget.permet(30 * 1000), 'et permet une unité qui tient');
  contexte.avancer(80 * 1000);
  egal(budget.reste(), 20 * 1000, 'le reste se calcule');
  verifier(!budget.permet(30 * 1000),
    'une unité de 30 s ne démarre pas sur 20 s restantes — le pari coûte l’exécution entière');
  verifier(budget.permet(10 * 1000), 'mais une unité de 10 s, oui');
  verifier(!budget.depasse(), 'le budget n’est pas encore dépassé');
  contexte.avancer(30 * 1000);
  verifier(budget.depasse(), 'il l’est une fois le plafond franchi');

  // Verrou.
  const trace = [];
  const premier = X.sousVerrou(() => { trace.push('travail'); return 7; });
  egal(premier, { pris: true, portee: 'document', valeur: 7 },
    'le verrou libre laisse passer');
  egal(contexte.etatVerrou.pris, false, 'et il est rendu à la fin');

  contexte.etatVerrou.pris = true;
  const second = X.sousVerrou(() => { trace.push('ne devrait pas'); });
  egal(second.pris, false, 'le verrou pris fait renoncer');
  verifier(/Attendez qu.elle\s*se termine/.test(second.message),
    'en disant quoi faire, pas seulement que c’est occupé');
  egal(trace, ['travail'], 'et l’opération n’a pas tourné');

  contexte.etatVerrou.pris = false;
  try {
    X.sousVerrou(() => { throw new Error('boum'); });
  } catch (e) { /* attendu */ }
  egal(contexte.etatVerrou.pris, false,
    'le verrou est rendu même quand l’opération lève — sinon plus rien ne tournerait');

  egal(premier.portee, 'document', 'et le résultat dit quelle portée d’exclusion a servi');

  // Projet autonome : Google rend `null`, il ne lève pas.
  const autonome = monter(['SocleExecution.gs'], { documentAccessible: false });
  const XA = autonome.lire('SocleExecution');
  egal(autonome.lire('LockService.getDocumentLock()'), null,
    'sans document, getDocumentLock() rend null — le faux service le reproduit');
  const repli = XA.sousVerrou(() => 'travail');
  egal(repli, { pris: true, portee: 'script', valeur: 'travail' },
    'le module retombe sur le verrou de script, et le DIT : une portée d’exclusion '
    + 'silencieusement élargie se découvre trop tard');

  // Déclencheurs.
  contexte.executer('function reprendreLeTravail() { return 1; }');
  egal(X.repriseProgrammee('reprendreLeTravail'), false, 'aucune reprise au départ');
  X.programmerReprise('reprendreLeTravail', 60 * 1000);
  egal(contexte.declencheurs.length, 1, 'une reprise est posée');
  egal(contexte.declencheurs[0].apres, 60 * 1000, 'au délai demandé');
  verifier(X.repriseProgrammee('reprendreLeTravail'), 'et elle se voit');

  X.programmerReprise('reprendreLeTravail', 60 * 1000);
  egal(contexte.declencheurs.length, 1,
    'en reprogrammer une ramasse la précédente — un déclencheur ponctuel ne s’efface pas seul');
  egal(X.retirerReprise('reprendreLeTravail'), 1, 'retirer dit combien');
  egal(contexte.declencheurs.length, 0, 'et le fait');

  leve(() => X.programmerReprise('fonctionQuiNExistePas', 60 * 1000),
    /Déclarez-la avec « function »/,
    'une cible inexistante est refusée tout de suite, pas une minute plus tard en arrière-plan');

  for (let i = 0; i < 20; i += 1) contexte.declencheurs.push({ nom: `autre-${i}` });
  leve(() => X.programmerReprise('reprendreLeTravail', 60 * 1000),
    /déjà 20 déclencheurs/, 'la limite de vingt est annoncée, pas dépassée');
}

section('E ter. Pagination');
{
  const contexte = monter(['SocleApi.gs']);
  const A = contexte.lire('SocleApi');

  leve(() => A.parcourir(() => ({}), {}), /attend le nom du champ/,
    'parcourir sans champ à accumuler est refusé');

  const pages = [
    { files: [1, 2], nextPageToken: 'p2' },
    { files: [3], nextPageToken: 'p3' },
    { files: [4, 5] },
  ];
  const vus = [];
  const tout = A.parcourir((jeton) => { vus.push(jeton); return pages.shift(); }, { champ: 'files' });
  egal(tout.elements, [1, 2, 3, 4, 5], 'les pages sont accumulées dans l’ordre');
  egal(tout.pages, 3, 'et comptées');
  egal(vus, [null, 'p2', 'p3'], 'chaque appel reçoit le jeton de la page précédente');
  egal(tout.complet, true, 'le parcours se dit complet quand il l’est');
  egal(tout.jetonSuivant, null, 'et ne laisse pas de jeton');

  egal(A.parcourir(() => ({}), { champ: 'files' }).elements, [],
    'une réponse sans le champ attendu rend une liste vide, sans lever');

  // La borne : une API qui rend toujours le même jeton ne doit pas tourner
  // jusqu'à ce que Google tue l'exécution.
  const boucle = A.parcourir(() => ({ files: ['x'], nextPageToken: 'toujours' }),
    { champ: 'files', pagesMax: 5 });
  egal(boucle.pages, 5, 'la borne de pages arrête le parcours');
  egal(boucle.complet, false, 'qui ne se dit surtout pas complet');
  egal(boucle.jetonSuivant, 'toujours', 'et rend le jeton pour reprendre là');

  // L'arrêt sur budget, sans dépendre de SocleExecution.
  const reste = { tours: 2 };
  const partiel = A.parcourir(() => ({ files: ['y'], nextPageToken: 'suite' }), {
    champ: 'files',
    permet: () => { reste.tours -= 1; return reste.tours >= 0; },
  });
  egal(partiel.complet, false, 'un arrêt sur budget se dit incomplet');
  egal(partiel.elements.length, 2, 'en gardant ce qui a été lu');
  egal(partiel.jetonSuivant, 'suite', 'et de quoi reprendre');
}

section('F bis. Échecs');
{
  const contexte = monter(['SocleErreurs.gs']);
  const E = contexte.lire('SocleErreurs');

  leve(() => E.erreur({ quoiFaire: 'Faites ceci.' }), /« quoi » est obligatoire/,
    'une erreur sans sujet est refusée');
  leve(() => E.erreur({ quoi: 'La synchronisation a échoué.' }),
    /« quoiFaire » est obligatoire/,
    'une erreur sans remède est refusée — c’est le refus qui fait le module');

  const erreur = E.erreur({
    quoi: 'Le dossier des photos n’est plus lisible.',
    quoiFaire: 'Repartagez-le avec ce compte, puis relancez la génération.',
    cause: 'DriveApp: Access denied (folder 1A2B)',
  });
  verifier(E.estAttendue(erreur), 'une erreur du module se reconnaît');
  verifier(!E.estAttendue(new Error('boum')), 'une exception quelconque ne s’y confond pas');
  verifier(erreur.message.includes('Repartagez-le'),
    'le remède fait partie du message, pas d’un champ que personne ne lira');

  // Les deux lectures du même échec.
  verifier(E.pourLUtilisateur(erreur).includes('Repartagez-le'),
    'l’utilisateur reçoit le remède');
  verifier(!E.pourLUtilisateur(erreur).includes('Access denied'),
    'et pas le détail technique, qui ne lui apprend rien');
  verifier(E.pourLeJournal(erreur).includes('Access denied'),
    'le journal reçoit la cause technique');

  const imprevue = new Error('Cannot read properties of undefined');
  verifier(E.pourLUtilisateur(imprevue).includes('imprévue'),
    'une exception imprévue est annoncée comme telle');
  verifier(E.pourLUtilisateur(imprevue).includes('pas votre saisie'),
    'et ne se déguise pas en conseil de saisie : faire passer un bug pour une '
    + 'faute de l’utilisateur l’envoie corriger ce qui n’a rien à se reprocher');
  verifier(E.pourLeJournal(imprevue).startsWith('Imprévue'),
    'le journal les distingue aussi');

  // Absorber, c'est compter — jamais avaler.
  leve(() => E.absorber('', () => { throw new Error('x'); }, null),
    /une cause doit être nommée/,
    'absorber sans nommer la cause est refusé : c’est le catch muet qu’on remplace');

  egal(E.absorber('lecture des membres du Drive', () => 'valeur', null), 'valeur',
    'une opération qui aboutit rend sa valeur');
  egal(E.bilan().total, 0, 'et ne compte rien');

  const repli = E.absorber('lecture des membres du Drive',
    () => { throw new Error('Access denied'); }, []);
  egal(repli, [], 'un échec rend le repli demandé');
  egal(E.bilan().total, 1, 'et laisse une trace');

  E.absorber('lecture des membres du Drive', () => { throw new Error('Timeout'); }, []);
  E.absorber('photo introuvable', () => { throw new Error('Not found'); }, null);
  const bilan = E.bilan();
  egal(bilan.total, 3, 'le bilan compte tous les échecs absorbés');
  egal(bilan.causes.map((c) => c.cause),
    ['lecture des membres du Drive', 'photo introuvable'],
    'agrégés par cause et non par victime, la plus fréquente en tête');
  egal(bilan.causes[0].occurrences, 2, 'avec leur nombre exact');
  egal(bilan.causes[0].premierMessage, 'Access denied',
    'le premier message est gardé — c’est souvent lui qui nomme la vraie cause');
  egal(bilan.causes[0].dernierMessage, 'Timeout', 'et le dernier aussi');

  egal(E.oublier().oubliees, 3, 'oublier dit ce qu’il efface');
  egal(E.bilan().total, 0, 'et le registre repart vide');
}

section('F sexies. Français / English');
{
  const contexte = monter(['SocleLangues.gs']);
  const L = contexte.lire('SocleLangues');

  leve(() => L.declarer({ chaines: { fr: {} } }), /attend une langue par défaut/,
    'déclarer sans langue par défaut est refusé');
  leve(() => L.declarer({ defaut: 'fr', chaines: { en: {} } }),
    /aucune table pour la langue par défaut/,
    'et sans table pour cette langue : c’est elle qui sert de repli');

  L.declarer({
    defaut: 'fr',
    chaines: {
      fr: {
        menuRegenerer: 'Régénérer maintenant',
        sauvegarde: 'Sauvegardé à {heure}',
        fichiers: { un: '{compte} fichier', plusieurs: '{compte} fichiers' },
        seulementFr: 'Présent en français seulement',
      },
      en: {
        menuRegenerer: 'Regenerate now',
        sauvegarde: 'Saved at {heure}',
        fichiers: { un: '{compte} file', plusieurs: '{compte} files' },
        enTrop: 'Only in English',
      },
    },
  });

  egal(L.traduire('fr', 'menuRegenerer'), 'Régénérer maintenant', 'la langue vient en premier');
  egal(L.traduire('en', 'menuRegenerer'), 'Regenerate now', 'et l’anglais suit');
  egal(L.traduire('de', 'menuRegenerer'), 'Régénérer maintenant',
    'une langue inconnue retombe sur le défaut, sans lever : une interface ne disparaît pas '
    + 'parce qu’un réglage est mal orthographié');

  egal(L.traduire('fr', 'sauvegarde', { heure: '14:05' }), 'Sauvegardé à 14:05',
    'les marqueurs sont remplacés');
  egal(L.traduire('fr', 'sauvegarde'), 'Sauvegardé à {heure}',
    'un marqueur sans valeur reste visible — « Sauvegardé à  » passerait inaperçu');

  // Le pluriel, et la seule règle qui sépare vraiment les deux langues.
  egal(L.traduire('fr', 'fichiers', { compte: 0 }), '0 fichier',
    'en français, zéro prend le SINGULIER');
  egal(L.traduire('en', 'fichiers', { compte: 0 }), '0 files',
    'en anglais, zéro prend le pluriel — c’est la règle qu’un code pensé en anglais oublie');
  egal(L.traduire('fr', 'fichiers', { compte: 1 }), '1 fichier', 'un au singulier');
  egal(L.traduire('fr', 'fichiers', { compte: 2 }), '2 fichiers', 'deux au pluriel');
  egal(L.traduire('en', 'fichiers', { compte: 1 }), '1 file', 'idem en anglais');
  egal(L.traduire('fr', 'fichiers'), '⟨fichiers sans compte⟩',
    'un pluriel appelé sans compte le dit, au lieu de choisir au hasard');

  // Une clé absente se voit.
  L.oublier();
  egal(L.traduire('fr', 'clePasDeclaree'), '⟨clePasDeclaree⟩',
    'une clé absente rend des chevrons — « ceci est un défaut », et non « ceci est un libellé »');
  egal(L.bilan().total, 1, 'et elle est comptée');
  verifier(L.bilan().entrees[0].quoi === '*:clePasDeclaree', 'nommément');

  L.oublier();
  egal(L.traduire('en', 'seulementFr'), 'Présent en français seulement',
    'une traduction absente retombe sur le défaut');
  egal(L.bilan().entrees[0].quoi, 'en:seulementFr',
    'mais la retombée est comptée : une langue à moitié traduite doit se voir');

  // La parité des tables — c’est ce que le banc d’un projet hôte appellera.
  const controle = L.verifier();
  egal(controle.completes, false, 'les tables ne sont pas complètes ici');
  egal(controle.manquantes.en, ['seulementFr'], 'la clé absente de l’anglais est nommée');
  egal(controle.surnumeraires.en, ['enTrop'], 'et celle qui n’existe qu’en anglais aussi');

  // Une clé pluralisée d’un côté seulement : aucune clé ne manque, et pourtant
  // la phrase sera fausse dans une langue.
  L.declarer({
    defaut: 'fr',
    chaines: {
      fr: { fichiers: { un: '{compte} fichier', plusieurs: '{compte} fichiers' } },
      en: { fichiers: '{compte} file(s)' },
    },
  });
  const formes = L.verifier();
  egal(formes.formes, ['en:fichiers'],
    'une clé pluralisée d’un côté et simple de l’autre est signalée');
  egal(formes.completes, false, 'et les tables ne sont pas déclarées complètes');

  L.declarer({
    defaut: 'fr',
    chaines: { fr: { a: 'A', b: 'B' }, en: { a: 'A', b: 'B' } },
  });
  egal(L.verifier().completes, true, 'deux tables identiques en clés sont complètes');
  egal(L.pour('en'), { a: 'A', b: 'B' }, 'pour() rend une seule langue, résolue');
}

section('F quinquies. Secrets');
{
  const contexte = monter(['SocleSecrets.gs']);
  const S = contexte.lire('SocleSecrets');

  leve(() => S.declarer({ nom: 'CLE_GEMINI', description: 'Console Cloud' }),
    /doit dire à qui il appartient/,
    'un secret sans portée est refusé — il n’y a pas de défaut, parce qu’un défaut '
    + 'serait la reconduction silencieuse du choix qu’on ne fait pas');
  leve(() => S.declarer({ nom: 'CLE_GEMINI', portee: 'globale', description: 'x' }),
    /partagee, document, personne/, 'et une portée inventée est refusée en listant les vraies');
  leve(() => S.declarer({ nom: 'CLE_GEMINI', portee: 'partagee' }),
    /doit porter une description/,
    'un secret sans description est refusé : « CLE_API » seul n’apprend à personne où la chercher');
  leve(() => S.lire('JAMAIS_DECLARE'), /n.a pas été déclaré/,
    'lire un secret non déclaré est refusé, plutôt que de rendre null');

  S.declarer({ nom: 'CLE_SERVICE', portee: 'partagee', description: 'Console Cloud > API' });
  S.declarer({ nom: 'JETON_PERSONNE', portee: 'personne', description: 'Consentement OAuth' });
  S.declarer({ nom: 'ID_CLASSEUR', portee: 'document', description: 'Classeur de rapport' });
  S.declarer({ nom: 'FACULTATIF', portee: 'partagee', description: 'Réglage optionnel',
    obligatoire: false });

  // Le cœur du module : chaque secret va dans SON magasin.
  S.ecrire('CLE_SERVICE', 'AIzaSyCommuneAToutLeMonde');
  S.ecrire('JETON_PERSONNE', 'ya29.jeton-strictement-personnel');
  S.ecrire('ID_CLASSEUR', '1AbC');

  verifier('CLE_SERVICE' in contexte.proprietes,
    'une clé de service va dans le magasin partagé');
  verifier(!('JETON_PERSONNE' in contexte.proprietes),
    'un jeton personnel ne va PAS dans le magasin partagé — c’est le défaut que '
    + 'la mesure a trouvé, et que l’isolation structurelle empêche');
  verifier('JETON_PERSONNE' in contexte.proprietesPersonne,
    'il va dans celui de la personne');
  verifier('ID_CLASSEUR' in contexte.proprietesDocument,
    'et un réglage de document dans celui du document');

  egal(S.lire('JETON_PERSONNE'), 'ya29.jeton-strictement-personnel', 'la relecture rend la valeur');
  egal(S.lire('FACULTATIF'), '', 'un secret facultatif absent rend une chaîne vide');
  leve(() => S.lire('CLE_MANQUANTE'), /n.a pas été déclaré/, 'et un inconnu lève');

  S.declarer({ nom: 'CLE_MANQUANTE', portee: 'partagee', description: 'Console Cloud > API' });
  leve(() => S.lire('CLE_MANQUANTE'), /Renseignez-le dans les propriétés « partagee »/,
    'un secret obligatoire absent dit où le renseigner, et dans quel magasin — sans quoi '
    + 'on le cherche là où il ne sera jamais');

  // Masquer : montrer qu'on l'a, jamais ce qu'on a.
  egal(S.masquer('ya29.jeton-strictement-personnel'), '••••nnel',
    'un secret long ne montre que ses quatre derniers caractères');
  egal(S.masquer('court'), '••••', 'un secret court ne montre rien du tout');
  egal(S.masquer(''), '', 'et une valeur vide reste vide');

  // L'inventaire : l'honnêteté du rapport appliquée aux secrets.
  const inventaire = S.inventaire();
  const par = {};
  inventaire.forEach((e) => { par[e.nom] = e; });
  egal(par.CLE_SERVICE.etat, 'renseignée', 'l’inventaire dit ce qui est en place');
  egal(par.CLE_MANQUANTE.etat, 'MANQUANTE', 'et ce qui manque');
  egal(par.FACULTATIF.etat, 'absente', 'en distinguant l’absent du manquant');
  egal(par.JETON_PERSONNE.apercu, '••••nnel', 'avec un aperçu masqué');
  const fuite = JSON.stringify(inventaire);
  verifier(!fuite.includes('ya29.jeton-strictement-personnel'),
    'et aucune valeur en clair nulle part dans l’inventaire');
  verifier(!fuite.includes('AIzaSyCommuneAToutLeMonde'), 'pour aucun des secrets');

  // Un magasin inexistant se dit, il ne se confond pas avec « manquante ».
  const sansDocument = monter(['SocleSecrets.gs'], { documentAccessible: false });
  const A = sansDocument.lire('SocleSecrets');
  A.declarer({ nom: 'ID_CLASSEUR', portee: 'document', description: 'Classeur de rapport' });
  egal(A.inventaire()[0].etat, 'illisible',
    'un magasin inexistant — script autonome, pas de document — se dit « illisible » '
    + 'et non « manquante » : une colonne vide veut dire non mesuré');
  leve(() => A.ecrire('ID_CLASSEUR', 'x'), /n.existe pas dans ce contexte/,
    'et y écrire lève un message utilisable, non un « Cannot read properties of null » '
    + 'qui n’apprend rien');
  verifier(/Rattachez-le à un classeur/.test(A.inventaire()[0].detail || ''),
    'le détail dit quoi faire : rattacher le script, ou changer la portée');

  leve(() => S.ecrire('CLE_SERVICE', 'x'.repeat(9500)), /dépasse les 9 Ko/,
    'une valeur trop longue est refusée en disant quoi faire');
}

section('F ter. Applications web');
{
  const contexte = monter(['SocleWeb.gs'], {
    fichiersHtml: { Index: '<p>bonjour</p>', SocleStyle: '<style>a{}</style>' },
  });
  const W = contexte.lire('SocleWeb');

  egal(W.inclure('SocleStyle'), '<style>a{}</style>', 'inclure rend le contenu du fichier');
  leve(() => W.inclure(''), /attend un nom de fichier/, 'inclure sans nom est refusé');
  leve(() => W.inclure('Absent'), /No HTML file named/,
    'un fichier absent lève, comme chez le vrai service');

  const page = W.page({ fichier: 'Index', titre: 'Audit des partages' });
  egal(page.titre, 'Audit des partages', 'la page porte son titre');
  egal(page.metas.viewport, 'width=device-width, initial-scale=1',
    'et la balise viewport, sans laquelle la page est illisible sur un téléphone');
  egal(page.modeCadre, 'DEFAULT', 'le défaut est fermé : la page ne s’intègre pas ailleurs');
  egal(W.page({ fichier: 'Index', integrable: true }).modeCadre, 'ALLOWALL',
    'et s’ouvre explicitement quand on le demande');
  leve(() => W.page({}), /attend un fichier à servir/, 'une page sans fichier est refusée');

  // Le piège de l'énumération : elle ne comporte que deux valeurs.
  egal(Object.keys(contexte.sandbox.HtmlService.XFrameOptionsMode).sort(),
    ['ALLOWALL', 'DEFAULT'],
    'XFrameOptionsMode ne comporte que ALLOWALL et DEFAULT — un DENY inventé vaudrait undefined');
  leve(() => contexte.lire('HtmlService').createHtmlOutputFromFile('Index')
    .setXFrameOptionsMode(contexte.sandbox.HtmlService.XFrameOptionsMode.DENY),
    /don't match the method signature/,
    'et le faux service refuse ce mode inventé, comme le vrai');

  // La frontière : une forme unique, quoi qu'il arrive.
  const reussite = W.frontiere('lister', () => [1, 2, 3]);
  egal(reussite, { ok: true, valeur: [1, 2, 3] }, 'une réussite rend sa valeur');

  const attendue = new Error('Le dossier n’est plus lisible. Repartagez-le, puis relancez.');
  attendue.quoiFaire = 'Repartagez-le, puis relancez.';
  const echecAttendu = W.frontiere('generer', () => { throw attendue; });
  egal(echecAttendu.ok, false, 'un échec le dit');
  verifier(echecAttendu.message.includes('Repartagez-le'),
    'une erreur qui porte un remède le transmet tel quel');
  verifier(/^\d{4}-\d{2}-\d{2} /.test(echecAttendu.reference),
    'et rend une référence horodatée, que l’utilisateur citera');

  contexte.journalErreurs.length = 0;
  const imprevu = W.frontiere('generer', () => {
    throw new Error('Cannot read properties of undefined (reading \'length\')');
  });
  verifier(imprevu.message.includes('imprévue'), 'une exception imprévue est annoncée comme telle');
  verifier(!imprevu.message.includes('Cannot read properties'),
    'et son message technique ne parvient pas à l’utilisateur — c’est exactement ce que '
    + 'les quatre projets mesurés affichaient brut');
  verifier(imprevu.message.includes(imprevu.reference),
    'le message porte la référence à citer');
  verifier(contexte.journalErreurs.some((l) => l.includes('Cannot read properties')),
    'mais le détail technique reste dans le journal, du côté de l’administrateur');
}

section('F quater. Le client et le serveur disent la même chose');
{
  // Les deux moitiés du même geste, écrites dans deux fichiers : rien ne les
  // tient ensemble sauf ce test. Dans les projets mesurés, la version client
  // échappait quatre caractères et la version serveur cinq.
  const html = fs.readFileSync(path.join(DOSSIER, 'SocleWebClient.html'), 'utf8');
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

  const bacClient = { window: {}, Promise, String, Error, console };
  bacClient.globalThis = bacClient;
  vm.createContext(bacClient);
  vm.runInContext(script, bacClient, { filename: 'SocleWebClient.html' });
  const client = bacClient.window.socle;

  verifier(!!client, 'le client se charge et publie window.socle');
  egal(client.version, fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim(),
    'et porte la version du socle');

  const serveur = monter(['SocleTexte.gs']).lire('SocleTexte');
  const cas = ['<a href="x" title=\'y\'>a & b</a>', '&lt;', null, '', 'sans rien',
    'guillemets " et apostrophes \'', 'déjà &amp; échappé'];
  const divergences = cas.filter((c) => client.echapper(c) !== serveur.echapperHtml(c));
  egal(divergences, [],
    'l’échappement du navigateur rend exactement ce que rend celui du serveur');

  // La frontière, vue du navigateur.
  // Le vrai appel est `…[nom].apply(null, args)` : `this` y vaut null. Un faux
  // qui rangerait ses gestionnaires sur `this` marcherait alors qu'il ne
  // devrait pas — et masquerait la faute le jour où le code s'y fierait.
  const gestionnaires = {};
  const run = {
    withSuccessHandler(f) { gestionnaires.ok = f; return run; },
    withFailureHandler(f) { gestionnaires.ko = f; return run; },
    reponseOk: () => gestionnaires.ok({ ok: true, valeur: 42 }),
    reponseEchec: () => gestionnaires.ok({
      ok: false, message: 'Repartagez le dossier.', reference: 'R1' }),
    reponseNue: () => gestionnaires.ok([1, 2]),
    planta: () => gestionnaires.ko(new Error('réseau')),
  };
  bacClient.google = { script: { run } };

  const attendre = (promesse) => promesse.then(
    (valeur) => ({ ok: valeur }), (erreur) => ({ erreur }));

  enAttente.push(Promise.all([
    attendre(client.demander('reponseOk')).then((r) => egal(r.ok, 42,
      'demander rend la valeur quand la frontière a réussi')),
    attendre(client.demander('reponseEchec')).then((r) => {
      verifier(r.erreur && r.erreur.message === 'Repartagez le dossier.',
        'et rejette avec le message destiné à l’utilisateur');
      egal(r.erreur.reference, 'R1', 'en gardant la référence à citer');
    }),
    attendre(client.demander('reponseNue')).then((r) => verifier(
      r.erreur && /n.est pas\s*enveloppée par SocleWeb\.frontiere/.test(r.erreur.message),
      'une fonction non enveloppée est signalée, plutôt que silencieusement mal lue')),
    attendre(client.appeler('planta')).then((r) => verifier(
      r.erreur && r.erreur.message === 'réseau', 'appeler rejette sur échec du serveur')),
  ]));
}

section('G. Feuille de style');
{
  // Une feuille de style ne s'exécute pas : on la contrôle. Ces règles sont
  // celles qui, relâchées une à une, transforment un système en accumulation.
  const css = fs.readFileSync(path.join(DOSSIER, 'SocleStyle.html'), 'utf8');
  const version = fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim();

  const declaree = (/--socle-version:\s*'([^']+)'/.exec(css) || [])[1];
  egal(declaree, version,
    'la version déclarée dans la feuille vaut le fichier VERSION — elle se lit '
    + 'depuis le navigateur, sur une application déployée');

  verifier((css.match(/<style>/g) || []).length === 1 && !css.includes('<script'),
    'le fichier ne porte qu’un bloc de style, et aucun script');

  // Tout jeton utilisé doit être défini : un var(--x) inconnu ne produit
  // aucune erreur, seulement une propriété qui ne s’applique pas.
  const definis = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
  const utilises = new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
  const inconnus = [...utilises].filter((j) => !definis.has(j)).sort();
  egal(inconnus, [], 'aucun jeton utilisé sans être défini');

  const inutilises = [...definis]
    .filter((j) => j !== '--socle-version' && !utilises.has(j)).sort();
  egal(inutilises, [], 'aucun jeton défini sans être utilisé');

  // Les deux thèmes déclarent le même ensemble : un jeton qui n’existerait que
  // dans le bloc sombre ne s’appliquerait jamais en thème clair — c’est ainsi
  // qu’on obtient du texte d’un thème sur le fond de l’autre.
  const blocs = [...css.matchAll(/:root(?:,\s*\.[\w-]+)?\s*\{([\s\S]*?)\n\s*\}/g)]
    .map((m) => m[1]);
  verifier(blocs.length === 2, `deux blocs :root, clair et sombre (trouvés : ${blocs.length})`);
  const jetonsDe = (bloc) => new Set([...bloc.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const clair = jetonsDe(blocs[0] || '');
  const sombre = jetonsDe(blocs[1] || '');
  egal([...sombre].filter((j) => !clair.has(j)).sort(), [],
    'le thème sombre ne redéfinit que des jetons déjà déclarés en clair');

  // Ce que le navigateur peint à notre place, et qui n'est thème-conscient
  // pour aucun de nos deux fonds. Un jeton non défini ne s'applique pas ; une
  // propriété jamais déclarée, elle, prend la valeur du navigateur — et cela
  // ne se voit qu'à l'écran.
  verifier(/\ba:visited\b/.test(css),
    'les liens visités sont stylés — sans quoi #551A8B, un bordeaux, se pose sur '
    + 'le fond sombre ; constaté sur une application web déployée');
  verifier(/\ba\b[^{]*\{[^}]*color:/.test(css.replace(/a:visited/g, '')),
    'et les liens non visités aussi');
  verifier(/(^|\n)\s*(html,\s*)?body\s*\{[^}]*background:/.test(css),
    'le fond se peint sur le document : une page centrée en largeur limitée '
    + 'laissait sinon paraître le blanc du navigateur de part et d’autre');

  // Aucune couleur littérale hors des jetons : c’est la règle qui garde un
  // système. Seule exception nommée, le bloc d’impression — le papier est
  // blanc dans les deux thèmes.
  const horsJetons = css
    .replace(/:root(?:,\s*\.[\w-]+)?\s*\{[\s\S]*?\n\s*\}/g, '')
    .replace(/@media print\s*\{[\s\S]*?\n\}/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const litterales = [...horsJetons.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].map((m) => m[0]);
  egal(litterales, [],
    'aucune couleur littérale hors des jetons, sauf dans le bloc d’impression');

  // Préfixe et langue : ce fichier atterrit dans des projets qui ont déjà leur
  // CSS, et les noms sont en français comme le reste.
  // Toutes les classes des sélecteurs, y compris composés — `.s-tableau
  // td.s-nombre` en définit deux, et n'en montrer qu'une ferait passer la
  // seconde pour inexistante.
  const cssSansCommentaires = css.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const selecteurs = cssSansCommentaires.split('\n')
    .filter((l) => l.includes('{') && !l.trim().startsWith('/*'))
    .concat(cssSansCommentaires.match(/^[^{}\n]+,\s*$/gm) || []);
  const classes = [...new Set(selecteurs
    .flatMap((l) => [...l.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])))];
  egal(classes.filter((c) => !c.startsWith('s-')), [],
    'toutes les classes portent le préfixe s-, pour ne pas entrer en collision');

  // Mots entiers, et non sous-chaînes : « tableau » contient « table »,
  // « modale » contient « modal », « progression » contient « progress ».
  // Comparer des fragments condamnerait le français au nom de l'anglais.
  const anglais = new Set(['button', 'card', 'badge', 'warning', 'primary', 'label',
    'input', 'table', 'row', 'grid', 'modal', 'header', 'footer', 'progress',
    'value', 'title', 'error', 'success', 'wrap', 'content']);
  const fautifs = classes
    .filter((c) => c.split(/-{1,2}|__/).some((mot) => anglais.has(mot)))
    .sort();
  egal(fautifs, [], 'les noms de classes sont en français, comme le reste du code');

  // La galerie est la documentation visuelle : si elle emploie une classe qui
  // n'existe plus, elle montre autre chose que ce que les projets obtiennent —
  // et c'est précisément ce qu'une documentation ne doit jamais faire.
  const galerie = fs.readFileSync(path.join(RACINE, 'outils', 'galerie.html'), 'utf8');
  const definiesCss = new Set(classes);
  const employees = new Set([...galerie.matchAll(/class="([^"]+)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter((c) => c.startsWith('s-')));
  const fantomes = [...employees].filter((c) => !definiesCss.has(c)).sort();
  egal(fantomes, [], 'la galerie n’emploie que des classes que la feuille définit');

  const jamaisMontrees = [...definiesCss].filter((c) => !employees.has(c)).sort();
  egal(jamaisMontrees, [], 'et la feuille ne définit rien que la galerie ne montre');
}

function conclure() {
  const attendues = [
    'A. Le socle comme ensemble', 'A bis. Les messages du socle disent quoi faire',
    'A ter. L’outil de contrôle', 'B. Dates', 'C. Texte', 'D. Feuilles',
    'E. Reprises', 'E bis. Le plafond des six minutes', 'E ter. Pagination',
    'F. Courriels', 'F bis. Échecs', 'F ter. Applications web',
    'F quater. Le client et le serveur disent la même chose',
    'F quinquies. Secrets', 'F sexies. Français / English', 'G. Feuille de style',
  ];
  const sautees = attendues.filter((t) => sectionsJouees.indexOf(t) === -1);
  if (sautees.length) {
    echecs.push(`Sections jamais exécutées : ${sautees.join(', ')}`);
    console.log(`\n  ÉCHEC : sections jamais exécutées — ${sautees.join(', ')}`);
  }

  console.log(`\n${passes} assertion(s) passée(s), ${echecs.length} échec(s).`);
  if (echecs.length > 0) {
    console.log('\nÉchecs :');
    echecs.forEach((e) => console.log(`  · ${e}`));
    process.exit(1);
  }
}

// Les sections synchrones ont toutes tourné ; on attend celles qui ne l'étaient
// pas avant de conclure. Surtout pas de `return` au niveau du module : il en
// sortirait, et sauterait tout ce qui suit sans un mot.
Promise.all(enAttente).then(conclure, (erreur) => {
  console.log(`\nLe banc s'est interrompu : ${erreur && erreur.message}`);
  process.exit(1);
});
