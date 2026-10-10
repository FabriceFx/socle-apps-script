# Démarrage

Prérequis : <!-- le compte, les droits, le service Workspace nécessaires. -->

## 1. Installer

1. Créez un classeur Google Sheets, puis **Extensions > Apps Script** (le projet doit être lié au classeur).
2. Supprimez le `Code.gs` par défaut.
3. Recréez chaque fichier de `apps-script/` sous le même nom (**+ > Script**) et collez son contenu.
4. **Paramètres du projet** : cochez « Afficher le fichier manifeste », puis collez `appsscript.json`.
5. Vérifiez que le fuseau est **{{FUSEAU}}** dans le projet *et* dans le classeur (*Fichier > Paramètres*).

Avec clasp, les étapes 1 à 4 se font en une commande depuis ce dossier :

```bash
clasp create-script --type sheets --title "{{TITRE}}" --rootDir apps-script
```

Puis vérifiez l'étape 5 : `clasp create` pose le fuseau du compte Google, pas le vôtre.

## 2. Premier lancement

1. Rechargez le classeur : le menu **{{TITRE}}** apparaît.
2. **À propos** affiche la version installée.

## En cas de souci

| Situation | Que faire |
|---|---|
| « Fonction de script introuvable » | Le déploiement sert une version figée : *Gérer les déploiements > modifier > Version : nouvelle version*. |
