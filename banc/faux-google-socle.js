/**
 * Banc d'essai — le cœur commun des services Google simulés. Introduit en v0.13.
 *
 * À recopier dans `banc/` d'un projet, comme un module du socle : `etat.js`
 * dit si la copie a dérivé. Ce qui est propre au projet — Reports, Gmail,
 * Drive, une API externe — s'ajoute dans son propre fichier, par-dessus.
 *
 * Il réunit ce que cinq simulateurs de projets avaient écrit chacun de leur
 * côté, en gardant chaque fois **la version la plus sévère** :
 *
 *   - le classeur interprète les chaînes comme Sheets : « =… » devient une
 *     formule, un nombre écrit en texte devient un nombre (sauf format « @ »),
 *     « yyyy-MM-dd » devient une `Date`, l'apostrophe force le texte ;
 *   - les `Date` sont fabriquées avec le constructeur **du bac à sable** : une
 *     `Date` de Node n'y serait pas `instanceof Date` ;
 *   - il refuse `undefined`, une plage hors de la feuille, des dimensions qui
 *     ne correspondent pas, avec les messages exacts de Google ;
 *   - trois magasins de propriétés distincts, 9 Ko par valeur ; sans document
 *     lié, `getDocumentProperties()` et `getDocumentLock()` rendent `null`,
 *     comme les vrais, au lieu d'un objet complaisant ;
 *   - `formatDate` rend les mois en anglais : il suit la locale du script, pas
 *     la langue qu'on voudrait ;
 *   - `computeDigest` rend des octets signés ;
 *   - 20 déclencheurs au plus, avec le message du vrai ;
 *   - `XFrameOptionsMode` ne connaît que ALLOWALL et DEFAULT ;
 *   - une horloge simulée avance à chaque `sleep`, pour tester les budgets de
 *     temps sans attendre.
 *
 * Et `chargerProjet` charge les `.gs` **dans l'ordre où clasp les pousse** —
 * alphabétique. Un banc qui les charge dans un ordre choisi à la main valide
 * un projet qui, chez Google, lève au chargement.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FAUX_GOOGLE_SOCLE_VERSION_ = '0.13.1';

const TAILLE_MAX_PROPRIETE = 9 * 1024;
const TAILLE_MAX_CACHE = 100 * 1024;
const EST_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const EST_NOMBRE = /^[+-]?(\d+([.,]\d+)?|\d*[.,]\d+)([eE][+-]?\d+)?$/;
const MOIS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const JOURS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const octetsSignes = (buffer) => [...buffer].map((o) => (o > 127 ? o - 256 : o));
// eslint-disable-next-line no-bitwise
const octetsNonSignes = (octets) => Buffer.from(octets.map((o) => o & 0xff));
const colonneEnIndice = (lettres) => [...lettres].reduce((n, c) => (n * 26) + (c.charCodeAt(0) - 64), 0);

/**
 * Pose les services simulés sur `sandbox`.
 *
 * @param {object} sandbox      le contexte vm
 * @param {object} reglages
 * @param {Function} reglages.DateContexte  le constructeur Date DU BAC À SABLE
 * @param {object} [reglages.options]
 *   documentAccessible (défaut true) — false pour un projet autonome ;
 *   fuseau (défaut 'Europe/Paris') ; utilisateur ; quotaCourriel (défaut 100) ;
 *   source — le dossier des .gs/.html, pour createTemplateFromFile.
 * @return {object} le journal de ce qui s'est passé, et des leviers de test
 */
const installerFauxGoogle = (sandbox, { DateContexte, options = {} }) => {
  const documentAccessible = options.documentAccessible !== false;
  const fuseau = options.fuseau || 'Europe/Paris';
  const horloge = { decalage: 0 };
  const journal = {
    toasts: [], alertes: [], menus: [], barresLaterales: [], modales: [], logs: [], courriels: [],
    pauses: 0, flushs: 0, cellulesLues: 0,
  };
  const leviers = { reponsesUi: [], verrouTenuAilleurs: false, pannesDeclencheur: 0 };

  const nowReel = DateContexte.now.bind(DateContexte);
  const maintenant = () => nowReel() + horloge.decalage;
  DateContexte.now = maintenant;

  /* ------------------------------ Classeur ------------------------------ */

  const commeSheets = (valeur, format) => {
    if (valeur === null) return '';
    if (typeof valeur === 'string') {
      if (valeur.startsWith('\'')) return { texte: valeur.slice(1) };
      if (valeur.startsWith('=')) return `#FORMULE(${valeur})`;
      if (format === '@') return valeur;
      if (EST_NOMBRE.test(valeur.trim())) return Number(valeur.trim().replace(',', '.'));
      if (EST_JOUR.test(valeur)) {
        const [a, m, j] = valeur.split('-').map(Number);
        return new DateContexte(a, m - 1, j);
      }
      return valeur;
    }
    if (Object.prototype.toString.call(valeur) === '[object Date]') return new DateContexte(valeur.getTime());
    return valeur;
  };

  class Cellule {
    constructor() { this.valeur = ''; this.format = null; }
  }

  class FaussePlage {
    constructor(feuille, ligne, colonne, hauteur, largeur) {
      if (hauteur < 1) throw new Error('The number of rows in the range must be at least 1.');
      if (largeur < 1) throw new Error('The number of columns in the range must be at least 1.');
      if (ligne < 1 || colonne < 1 || ligne + hauteur - 1 > feuille.maxLignes
        || colonne + largeur - 1 > feuille.maxColonnes) {
        throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      }
      Object.assign(this, { feuille, ligne, colonne, hauteur, largeur });
    }

    cellules(fn) {
      for (let l = 0; l < this.hauteur; l += 1) {
        for (let c = 0; c < this.largeur; c += 1) fn(this.feuille.cellule(this.ligne + l, this.colonne + c), l, c);
      }
      return this;
    }

    verifierDimensions(valeurs, quoi = 'data') {
      if (!Array.isArray(valeurs) || valeurs.length !== this.hauteur) {
        throw new Error(`The number of rows in the ${quoi} does not match the number of rows in the range. `
          + `The ${quoi} has ${valeurs && valeurs.length} but the range has ${this.hauteur}.`);
      }
      valeurs.forEach((ligne) => {
        if (!Array.isArray(ligne) || ligne.length !== this.largeur) {
          throw new Error(`The number of columns in the ${quoi} does not match the number of columns in the range. `
            + `The ${quoi} has ${ligne && ligne.length} but the range has ${this.largeur}.`);
        }
        ligne.forEach((v) => {
          if (v === undefined) throw new Error('Exception: Invalid argument: undefined');
        });
      });
    }

    getRow() { return this.ligne; }
    getColumn() { return this.colonne; }
    getNumRows() { return this.hauteur; }
    getNumColumns() { return this.largeur; }
    getSheet() { return this.feuille; }

    getValues() {
      const sortie = [];
      for (let l = 0; l < this.hauteur; l += 1) {
        const ligne = [];
        for (let c = 0; c < this.largeur; c += 1) {
          const cellule = this.feuille.lire(this.ligne + l, this.colonne + c);
          let v = cellule ? cellule.valeur : '';
          if (v && typeof v === 'object' && 'texte' in v) v = v.texte;
          if (Object.prototype.toString.call(v) === '[object Date]') v = new DateContexte(v.getTime());
          ligne.push(v);
        }
        sortie.push(ligne);
      }
      journal.cellulesLues += this.hauteur * this.largeur;
      return sortie;
    }

    getValue() { return this.getValues()[0][0]; }

    getDisplayValues() {
      return this.getValues().map((ligne) => ligne.map((v) => (v === '' ? '' : String(v))));
    }

    setValues(valeurs) {
      this.verifierDimensions(valeurs);
      return this.cellules((cellule, l, c) => {
        cellule.valeur = commeSheets(valeurs[l][c], cellule.format);
      });
    }

    setValue(valeur) {
      if (valeur === undefined) throw new Error('Exception: Invalid argument: value');
      return this.setValues(Array.from({ length: this.hauteur }, () => Array.from({ length: this.largeur }, () => valeur)));
    }

    setNumberFormat(format) {
      if (typeof format !== 'string') throw new Error('Exception: Invalid argument: numberFormat');
      return this.cellules((cellule) => { cellule.format = format; });
    }

    clearContent() { return this.cellules((cellule) => { cellule.valeur = ''; }); }
    clear() { return this.cellules((cellule) => { cellule.valeur = ''; cellule.format = null; }); }

    setFontColor(couleur) {
      if (typeof couleur !== 'string') throw new Error('Exception: Invalid argument: color');
      return this;
    }

    setBackground(couleur) {
      if (couleur !== null && typeof couleur !== 'string') throw new Error('Exception: Invalid argument: color');
      return this;
    }

    setNote(note) {
      if (typeof note !== 'string') throw new Error('Exception: Invalid argument: note');
      return this;
    }

    setFontWeight() { return this; }
    setFontStyle() { return this; }
    setFontSize() { return this; }
    setFontFamily() { return this; }
    setHorizontalAlignment() { return this; }
    setVerticalAlignment() { return this; }
    setWrap() { return this; }
    setBorder() { return this; }
    merge() { return this; }
    activate() { return this; }
  }

  class FausseFeuille {
    constructor(classeur, nom) {
      Object.assign(this, { classeur, nom, lignes: [], maxLignes: 1000, maxColonnes: 26, masquee: false, figees: 0 });
    }

    cellule(l, c) {
      while (this.lignes.length < l) this.lignes.push([]);
      const ligne = this.lignes[l - 1];
      while (ligne.length < c) ligne.push(new Cellule());
      return ligne[c - 1];
    }

    lire(l, c) {
      const ligne = this.lignes[l - 1];
      return ligne ? ligne[c - 1] : undefined;
    }

    getName() { return this.nom; }
    getSheetName() { return this.nom; }
    setName(nom) {
      if (this.classeur.feuilles.some((f) => f !== this && f.nom === nom)) {
        throw new Error(`A sheet with the name "${nom}" already exists. Please enter another name.`);
      }
      this.nom = nom;
      return this;
    }

    getLastRow() {
      for (let l = this.lignes.length; l >= 1; l -= 1) {
        if (this.lignes[l - 1].some((c) => c.valeur !== '')) return l;
      }
      return 0;
    }

    getLastColumn() {
      let max = 0;
      this.lignes.forEach((ligne) => ligne.forEach((c, i) => { if (c.valeur !== '') max = Math.max(max, i + 1); }));
      return max;
    }

    getMaxRows() { return this.maxLignes; }
    getMaxColumns() { return this.maxColonnes; }

    getRange(a, b, c, d) {
      if (typeof a === 'string') {
        const m = a.match(/^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/);
        if (!m) throw new Error(`Range not found: ${a}`);
        const col1 = colonneEnIndice(m[1]);
        const lig1 = m[2] ? Number(m[2]) : 1;
        const col2 = m[3] ? colonneEnIndice(m[3]) : col1;
        const lig2 = m[3] ? (m[4] ? Number(m[4]) : this.maxLignes) : lig1;
        return new FaussePlage(this, lig1, col1, lig2 - lig1 + 1, col2 - col1 + 1);
      }
      if ([a, b].some((v) => typeof v !== 'number' || Number.isNaN(v))) throw new Error('Exception: Invalid argument: row');
      return new FaussePlage(this, a, b, c === undefined ? 1 : c, d === undefined ? 1 : d);
    }

    getDataRange() {
      return new FaussePlage(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
    }

    appendRow(valeurs) {
      this.getRange(this.getLastRow() + 1, 1, 1, valeurs.length).setValues([valeurs]);
      return this;
    }

    deleteRows(debut, nombre) { this.lignes.splice(debut - 1, nombre); return this; }
    clear() { this.lignes = []; return this; }
    clearContents() { this.lignes.forEach((l) => l.forEach((c) => { c.valeur = ''; })); return this; }
    setFrozenRows(n) { this.figees = n; return this; }
    getFrozenRows() { return this.figees; }
    hideSheet() { this.masquee = true; return this; }
    showSheet() { this.masquee = false; return this; }
    isSheetHidden() { return this.masquee; }
    setColumnWidth() { return this; }
    setRowHeight() { return this; }
    autoResizeColumns() { return this; }
    activate() { this.classeur.active = this; return this; }
  }

  const classeur = {
    feuilles: [],
    active: null,
    getSheetByName(nom) { return this.feuilles.find((f) => f.nom === nom) || null; },
    getSheets() { return [...this.feuilles]; },
    insertSheet(nom, index) {
      const nomFinal = nom === undefined ? `Sheet${this.feuilles.length + 1}` : nom;
      if (this.getSheetByName(nomFinal)) {
        throw new Error(`A sheet with the name "${nomFinal}" already exists. Please enter another name.`);
      }
      const feuille = new FausseFeuille(this, nomFinal);
      if (typeof index === 'number') this.feuilles.splice(index, 0, feuille);
      else this.feuilles.push(feuille);
      this.active = feuille;
      return feuille;
    },
    deleteSheet(feuille) {
      if (this.feuilles.length === 1) {
        throw new Error('You can\'t remove all the sheets in a document.');
      }
      this.feuilles = this.feuilles.filter((f) => f !== feuille);
    },
    getActiveSheet() { return this.active || this.feuilles[0]; },
    setActiveSheet(feuille) { this.active = feuille; return feuille; },
    getId: () => options.idClasseur || 'classeur-de-test',
    getName: () => options.nomClasseur || 'Classeur de test',
    getUrl: () => `https://docs.google.com/spreadsheets/d/${options.idClasseur || 'classeur-de-test'}/edit`,
    getSpreadsheetTimeZone: () => options.fuseauClasseur || fuseau,
    toast(message, titre) { journal.toasts.push({ message, titre }); },
  };

  const ui = {
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO', YES_NO_CANCEL: 'YES_NO_CANCEL' },
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO', CLOSE: 'CLOSE' },
    alert(a, b, c) {
      const entree = b === undefined ? { message: a } : { titre: a, message: b, boutons: c };
      journal.alertes.push(entree);
      if (!entree.boutons || entree.boutons === 'OK') return 'OK';
      return leviers.reponsesUi.length ? leviers.reponsesUi.shift() : 'CANCEL';
    },
    createMenu(titre) {
      if (typeof titre !== 'string' || titre === '') throw new Error('Invalid argument: caption');
      const menu = { titre, entrees: [] };
      const constructeur = {
        addItem: (libelle, fonction) => { menu.entrees.push({ libelle, fonction }); return constructeur; },
        addSeparator: () => constructeur,
        addSubMenu: (sous) => { menu.entrees.push({ sousMenu: sous }); return constructeur; },
        addToUi: () => { journal.menus.push(menu); },
      };
      return constructeur;
    },
    showSidebar(sortie) { journal.barresLaterales.push(sortie); },
    showModalDialog(sortie, titre) {
      if (!sortie || typeof sortie.getContent !== 'function') throw new Error('Exception: Invalid argument: userInterface');
      journal.modales.push({ titre, html: sortie.getContent() });
    },
  };

  sandbox.SpreadsheetApp = {
    // Un projet autonome n'a pas de classeur actif : null, comme le vrai.
    getActiveSpreadsheet: () => (documentAccessible ? classeur : null),
    getActive: () => (documentAccessible ? classeur : null),
    getUi: () => ui,
    flush: () => { journal.flushs += 1; },
  };

  /* ------------------------------ Propriétés ------------------------------ */

  const magasin = () => {
    const donnees = new Map();
    const verifier = (cle, valeur) => {
      if (typeof cle !== 'string' || cle === '') throw new Error('Exception: Invalid argument: key');
      if (Buffer.byteLength(String(valeur), 'utf8') > TAILLE_MAX_PROPRIETE) throw new Error('Exception: Argument too large: value');
    };
    return {
      donnees,
      getProperty: (cle) => (donnees.has(cle) ? donnees.get(cle) : null),
      getProperties: () => Object.fromEntries(donnees),
      getKeys: () => [...donnees.keys()],
      setProperty(cle, valeur) { verifier(cle, valeur); donnees.set(cle, String(valeur)); return this; },
      setProperties(objet, effacerLesAutres) {
        Object.entries(objet).forEach(([cle, valeur]) => verifier(cle, valeur));
        if (effacerLesAutres) donnees.clear();
        Object.entries(objet).forEach(([cle, valeur]) => donnees.set(cle, String(valeur)));
        return this;
      },
      deleteProperty(cle) { donnees.delete(cle); return this; },
      deleteAllProperties() { donnees.clear(); return this; },
    };
  };
  // Trois magasins, jamais un seul : un jeton rangé dans le partagé y
  // paraîtrait aussi isolé que dans celui de la personne.
  const proprietes = { script: magasin(), document: magasin(), utilisateur: magasin() };
  sandbox.PropertiesService = {
    getScriptProperties: () => proprietes.script,
    getDocumentProperties: () => (documentAccessible ? proprietes.document : null),
    getUserProperties: () => proprietes.utilisateur,
  };

  /* ------------------------------ Cache et verrous ------------------------------ */

  const fabriquerCache = () => {
    const entrees = new Map();
    return {
      get: (cle) => {
        const e = entrees.get(cle);
        return e && e.fin > maintenant() ? e.valeur : null;
      },
      put: (cle, valeur, secondes = 600) => {
        if (secondes > 21600) throw new Error('Exception: Invalid argument: expirationInSeconds');
        if (Buffer.byteLength(String(valeur), 'utf8') > TAILLE_MAX_CACHE) throw new Error('Exception: Argument too large: value');
        entrees.set(cle, { valeur: String(valeur), fin: maintenant() + (secondes * 1000) });
      },
      remove: (cle) => { entrees.delete(cle); },
    };
  };
  const caches = { script: fabriquerCache(), document: fabriquerCache(), utilisateur: fabriquerCache() };
  sandbox.CacheService = {
    getScriptCache: () => caches.script,
    getDocumentCache: () => (documentAccessible ? caches.document : null),
    getUserCache: () => caches.utilisateur,
  };

  const fabriquerVerrou = () => {
    const etat = { tenu: false };
    return {
      tryLock: () => {
        if (leviers.verrouTenuAilleurs || etat.tenu) return false;
        etat.tenu = true;
        return true;
      },
      waitLock: () => {
        if (leviers.verrouTenuAilleurs) throw new Error('Lock timeout: another process was holding the lock for too long.');
        etat.tenu = true;
      },
      hasLock: () => etat.tenu,
      releaseLock: () => { etat.tenu = false; },
    };
  };
  const verrous = { script: fabriquerVerrou(), document: fabriquerVerrou(), utilisateur: fabriquerVerrou() };
  sandbox.LockService = {
    getScriptLock: () => verrous.script,
    getDocumentLock: () => (documentAccessible ? verrous.document : null),
    getUserLock: () => verrous.utilisateur,
  };

  /* ------------------------------ Utilitaires ------------------------------ */

  // Les parties d'une date dans un fuseau donné, sans dépendre de la locale de Node.
  const parties = (date, zone) => {
    const brut = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'long', hourCycle: 'h23',
    }).formatToParts(date).map((p) => [p.type, p.value]));
    return {
      a: Number(brut.year), m: Number(brut.month), j: Number(brut.day),
      h: Number(brut.hour), mi: Number(brut.minute), s: Number(brut.second),
      js: JOURS_EN.indexOf(brut.weekday), ms: date.getMilliseconds(),
    };
  };
  const deux = (n) => String(n).padStart(2, '0');

  sandbox.Utilities = {
    DigestAlgorithm: { MD5: 'MD5', SHA_1: 'SHA_1', SHA_256: 'SHA_256', SHA_512: 'SHA_512' },
    Charset: { UTF_8: 'UTF_8', US_ASCII: 'US_ASCII' },
    computeDigest: (algo, texte, charset = 'UTF_8') => {
      const noms = { MD5: 'md5', SHA_1: 'sha1', SHA_256: 'sha256', SHA_512: 'sha512' };
      if (!noms[algo]) throw new Error('Exception: Invalid argument: algorithm');
      if (charset !== 'UTF_8' && charset !== 'US_ASCII') throw new Error('Exception: Invalid argument: charset');
      const donnees = Array.isArray(texte) ? octetsNonSignes(texte) : Buffer.from(String(texte), 'utf8');
      return octetsSignes(crypto.createHash(noms[algo]).update(donnees).digest());
    },
    base64Encode: (donnees) => (Array.isArray(donnees) ? octetsNonSignes(donnees) : Buffer.from(String(donnees), 'utf8')).toString('base64'),
    base64Decode: (texte) => octetsSignes(Buffer.from(String(texte), 'base64')),
    newBlob: (donnees, type = 'text/plain', nom = null) => {
      const octets = Array.isArray(donnees) ? octetsNonSignes(donnees) : Buffer.from(String(donnees), 'utf8');
      return {
        getBytes: () => octetsSignes(octets),
        getDataAsString: () => octets.toString('utf8'),
        getContentType: () => type,
        getName: () => nom,
        setName(n) { nom = n; return this; },   // eslint-disable-line no-param-reassign
      };
    },
    getUuid: () => crypto.randomUUID(),
    sleep: (ms) => { journal.pauses += ms; horloge.decalage += ms; },
    formatDate: (date, zone, motif) => {
      if (!date || typeof date.getTime !== 'function') throw new Error('Exception: Invalid argument: date');
      if (typeof zone !== 'string' || zone === '') throw new Error('Exception: Invalid argument: timeZone');
      const p = parties(date, zone);
      const decalage = () => {
        const local = Date.UTC(p.a, p.m - 1, p.j, p.h, p.mi, p.s);
        const minutes = Math.round((local - (date.getTime() - p.ms)) / 60000);
        const signe = minutes < 0 ? '-' : '+';
        return [signe, deux(Math.floor(Math.abs(minutes) / 60)), deux(Math.abs(minutes) % 60)];
      };
      const jetons = {
        yyyy: () => String(p.a), yy: () => String(p.a).slice(-2),
        MMMM: () => MOIS_EN[p.m - 1], MMM: () => MOIS_EN[p.m - 1].slice(0, 3), MM: () => deux(p.m), M: () => String(p.m),
        dd: () => deux(p.j), d: () => String(p.j),
        EEEE: () => JOURS_EN[p.js], EEE: () => JOURS_EN[p.js].slice(0, 3),
        HH: () => deux(p.h), H: () => String(p.h), mm: () => deux(p.mi), ss: () => deux(p.s),
        SSS: () => String(p.ms).padStart(3, '0'),
        XXX: () => { const [s, h, m] = decalage(); return `${s}${h}:${m}`; },
        Z: () => decalage().join(''),
      };
      return motif.replace(/'([^']*)'|yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|H|mm|ss|SSS|XXX|Z/g,
        (jeton, litteral) => (litteral !== undefined ? litteral : jetons[jeton]()));
    },
  };

  sandbox.Session = {
    getActiveUser: () => ({ getEmail: () => options.utilisateur || 'personne@exemple.fr' }),
    getEffectiveUser: () => ({ getEmail: () => options.utilisateur || 'personne@exemple.fr' }),
    getActiveUserLocale: () => options.langue || 'fr',
    getScriptTimeZone: () => fuseau,
    getTemporaryActiveUserKey: () => 'cle-temporaire',
  };

  sandbox.Logger = { log: (message) => { journal.logs.push(String(message)); } };

  /* ------------------------------ Déclencheurs ------------------------------ */

  const declencheurs = [];
  let compteur = 0;
  const WeekDay = Object.fromEntries(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
    .map((j) => [j, j]));
  sandbox.ScriptApp = {
    WeekDay,
    getProjectTriggers: () => [...declencheurs],
    deleteTrigger: (declencheur) => {
      const i = declencheurs.indexOf(declencheur);
      if (i === -1) throw new Error('Exception: Invalid argument: trigger');
      declencheurs.splice(i, 1);
    },
    newTrigger: (fonction) => {
      if (typeof fonction !== 'string' || fonction === '') throw new Error('Exception: Invalid argument: functionName');
      const spec = { fonction };
      const creer = () => {
        if (leviers.pannesDeclencheur > 0) {
          leviers.pannesDeclencheur -= 1;
          throw new Error('Exception: Service error: ScriptApp');
        }
        if (declencheurs.length >= 20) {
          throw new Error('This script has too many triggers. Triggers must be deleted from the script before more can be added.');
        }
        compteur += 1;
        const declencheur = {
          getHandlerFunction: () => fonction, getUniqueId: () => `declencheur-${compteur}`, spec,
        };
        declencheurs.push(declencheur);
        return declencheur;
      };
      const temporel = {
        after: (ms) => { spec.apres = ms; return temporel; },
        everyMinutes: (n) => {
          if (![1, 5, 10, 15, 30].includes(n)) throw new Error('Exception: Invalid argument: minutes');
          spec.minutes = n; return temporel;
        },
        everyHours: (n) => { spec.heures = n; return temporel; },
        everyDays: (n) => { spec.jours = n; return temporel; },
        everyWeeks: (n) => { spec.semaines = n; return temporel; },
        onWeekDay: (jour) => {
          if (!WeekDay[jour]) throw new Error('Exception: Invalid argument: day');
          spec.jourSemaine = jour; return temporel;
        },
        atHour: (h) => {
          if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error('Exception: Invalid argument: hour');
          spec.heure = h; return temporel;
        },
        nearMinute: (m) => { spec.minute = m; return temporel; },
        create: creer,
      };
      return {
        timeBased: () => temporel,
        forSpreadsheet: () => ({ onOpen: () => ({ create: creer }), onEdit: () => ({ create: creer }), onChange: () => ({ create: creer }) }),
      };
    },
  };

  /* ------------------------------ HTML ------------------------------ */

  const XFrameOptionsMode = { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' };
  const sortieHtml = (contenu) => {
    const sortie = {
      contenu, titre: '', largeur: null, hauteur: null, cadre: 'DEFAULT',
      getContent: () => sortie.contenu,
      setTitle: (t) => { sortie.titre = t; return sortie; },
      setWidth: (l) => { sortie.largeur = l; return sortie; },
      setHeight: (h) => { sortie.hauteur = h; return sortie; },
      setXFrameOptionsMode: (mode) => {
        if (!Object.values(XFrameOptionsMode).includes(mode)) throw new Error('Exception: Invalid argument: mode');
        sortie.cadre = mode; return sortie;
      },
      addMetaTag: () => sortie,
      setFaviconUrl: () => sortie,
      append: (texte) => { sortie.contenu += texte; return sortie; },
    };
    return sortie;
  };
  const lireFichierHtml = (nom) => {
    if (!options.source) throw new Error('Faux HtmlService : options.source non renseigné');
    const chemin = path.join(options.source, `${nom}.html`);
    if (!fs.existsSync(chemin)) throw new Error(`Exception: No HTML file named ${nom} was found.`);
    return fs.readFileSync(chemin, 'utf8');
  };
  sandbox.HtmlService = {
    XFrameOptionsMode,
    createHtmlOutput: (contenu = '') => sortieHtml(String(contenu)),
    createHtmlOutputFromFile: (nom) => sortieHtml(lireFichierHtml(nom)),
    // Les scriptlets ne sont pas évalués : le gabarit rend son texte brut.
    // Un banc qui veut tester le rendu d'un gabarit le dit dans son propre fichier.
    createTemplateFromFile: (nom) => {
      const gabarit = { evaluate: () => sortieHtml(lireFichierHtml(nom)) };
      return gabarit;
    },
  };

  /* ------------------------------ Courriel ------------------------------ */

  let quota = options.quotaCourriel === undefined ? 100 : options.quotaCourriel;
  sandbox.MailApp = {
    getRemainingDailyQuota: () => quota,
    sendEmail: (...args) => {
      const message = typeof args[0] === 'object' ? args[0] : { to: args[0], subject: args[1], body: args[2], ...(args[3] || {}) };
      if (!message.to) throw new Error('Exception: Invalid argument: recipient');
      if (quota <= 0) throw new Error('Exception: Service invoked too many times for one day: email.');
      quota -= 1;
      journal.courriels.push(message);
    },
  };

  return {
    journal, leviers, classeur, proprietes, caches, verrous, declencheurs, horloge,
    ajouterFeuille: (nom, lignes = []) => {
      const feuille = classeur.insertSheet(nom);
      if (lignes.length) feuille.getRange(1, 1, lignes.length, lignes[0].length).setValues(lignes);
      return feuille;
    },
  };
};

/**
 * Charge un projet Apps Script dans un bac à sable, **dans l'ordre de clasp**.
 *
 * @param {string} source  le dossier qui porte appsscript.json
 * @param {object} [options]  transmises à installerFauxGoogle
 * @return {{contexte, lire: function(string), faux: object, fichiers: string[]}}
 *   `lire('NOM')` rend une valeur de portée globale — les `const` n'étant pas
 *   des propriétés de l'objet global, on ne peut pas les lire autrement.
 */
const chargerProjet = (source, options = {}) => {
  const sandbox = { console };
  const contexte = vm.createContext(sandbox);
  const DateContexte = vm.runInContext('Date', contexte);
  const faux = installerFauxGoogle(sandbox, { DateContexte, options: { source, ...options } });
  const fichiers = fs.readdirSync(source)
    .filter((f) => f.endsWith('.gs'))
    .sort((a, b) => a.localeCompare(b));
  fichiers.forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(source, f), 'utf8'), contexte, { filename: f });
  });
  return {
    contexte, faux, fichiers, lire: (expression) => vm.runInContext(expression, contexte),
  };
};

module.exports = {
  FAUX_GOOGLE_SOCLE_VERSION: FAUX_GOOGLE_SOCLE_VERSION_, installerFauxGoogle, chargerProjet, octetsSignes,
};
