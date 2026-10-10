# {{TITRE}}

[Français](#français) · [English](#english)

<a name="français"></a>
## Français

<!-- À quoi sert l'outil, pour qui, en trois phrases. Ce qu'il remplace. -->

Pour l'installer et s'en servir, voir **[DEMARRAGE.md](DEMARRAGE.md)**.

### Choix de conception

| Choix | Pourquoi |
|---|---|
| Le projet est **lié au classeur**. | Chaque action s'exécute sous l'identité de qui clique ; aucun déclencheur installable ne prête ses droits. |
| Le numéro de version est dans **une seule constante**, affichée par « À propos ». | Un déploiement sert une copie figée : c'est le seul moyen de savoir laquelle tourne. |

### Portées demandées

| Portée | Pourquoi |
|---|---|
| `spreadsheets.currentonly` | Lire et écrire ce classeur, et lui seul. |

### Développement

```bash
node banc/test.js
node ../socle-apps-script/outils/verifier.js
```

Le banc charge les fichiers dans l'ordre où clasp les pousse, avec les
services Google simulés de `banc/faux-google-socle.js` (socle v{{SOCLE_VERSION}}).

### Licence

{{LICENCE_TEXTE}}

<a name="english"></a>
## English

<!-- What the tool does, for whom, in three sentences. -->

See **[DEMARRAGE.md](DEMARRAGE.md)** (in French) to install it.

### License

{{LICENCE_TEXTE_EN}}
