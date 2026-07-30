# playground — la proposition `resource({ lazy: true })`, exécutable

Application Angular 22 (standalone, zoneless, signaux, sans router) qui présente la proposition
comme une page unique et linéaire : description (contexte → problème → #58422 → `@defer`),
solution proposée, alternatives, cas d'usage joués, tests, implémentation.

**Les démos exécutent le code de la PR lui-même** : `@angular/core` est pinné en 22.1.0 et le
diff du fork est appliqué au bundle publié (`fesm2022/_resource-chunk.mjs` + le `.d.ts`) via
**patch-package** (`patches/@angular+core+22.1.0.patch`, rejoué par le postinstall). Chaque
figure exécute donc le natif `rxResource({ lazy: true })`. La version userland
(`src/app/lazy-rx-resource.ts`) reste la copie verbatim de la référence, à recopier en attendant
que ça atterrisse — c'est l'« alternative 39/39 » du tableau.

## Lancer

```sh
npm install   # le postinstall applique patches/ via patch-package
npx ng serve
```

## Architecture des démos

- `main.ts` bootstrappe `App` (le document) ou `DemoPage` selon `?demo=<name>`.
- Chaque démo est une **page autonome** (`/?demo=chain`) : titre, Reset, lien retour, démo,
  journal réseau ancré dessous. `demo-registry.ts` fait la correspondance nom → composant +
  fichier + titre.
- Les figures du document **embarquent cette page en iframe** (`&embed=1` : chrome masqué,
  hauteur remontée au parent par `postMessage` + `ResizeObserver`). Le journal réseau reste
  visible pendant qu'on manipule ; Reset recharge l'iframe ; « open ↗ » ouvre la démo seule.
- La barre de chaque figure porte le toggle de syntaxe synchronisé (`lazy: true` /
  `lazyRxResource`) : snippets écrits en syntaxe proposition, variante userland dérivée
  mécaniquement (`toUserland` dans `figure.ts`).

## StackBlitz

Le projet est prévu pour être déposé tel quel (le postinstall rejoue le patch dans le
WebContainer). Après upload, renseigner `STACKBLITZ_PROJECT` dans `demo-registry.ts` : les
liens « edit ↗ » apparaissent alors sur chaque figure et sur les pages de démo
(`?file=src/app/demo-*.ts&initialpath=/?demo=<name>`).

## Où est l'implémentation

- **Native (la PR)** : branche `feat/lazy-resource` sur flo-dmtx/angular ; ici sous forme du
  patch `patches/@angular+core+22.1.0.patch`, mêmes hunks portés sur le bundle publié.
- **Userland** : `src/app/lazy-rx-resource.ts`, copie verbatim de
  `../lazy-resource/src/lazy-rx-resource.ts` (aucune modification locale — tout correctif se
  fait là-bas puis se recopie ici).
