# playground — la proposition `resource({ lazy: true })`, exécutable

Application Angular 22 (standalone, zoneless, signaux, sans router) qui présente la proposition
comme une page unique et linéaire : description (contexte → problème → #58422 → `@defer`),
solution proposée, alternatives, cas d'usage joués, tests, implémentation.

**Les démos exécutent le code de la PR lui-même** : `@angular/core` est pinné en 22.1.0 et le
diff du fork est appliqué au bundle publié (`fesm2022/_resource-chunk.mjs` + le `.d.ts`) via
**patch-package** (`patches/@angular+core+22.1.0.patch`, rejoué par le postinstall). Chaque
figure exécute donc le natif `rxResource({ lazy: true })`. La version userland
(`src/app/lazy-resource.ts`, exports `lazyResource` + `lazyRxResource`) reste la copie verbatim de la référence, à recopier en attendant
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

## Hébergement

- **GitHub Pages** : https://flo-dmtx.github.io/lazy-resource-playground/ — servi depuis la
  branche `gh-pages`. Redéploiement (pas d'Actions : le token gh local n'a pas le scope
  `workflow` ; `gh auth refresh -s workflow` permettrait d'y passer) :

  ```sh
  npx ng build --base-href ./
  cd dist/playground/browser && touch .nojekyll && git init -b gh-pages \
    && git add -A && git commit -m deploy \
    && git push -f https://github.com/flo-dmtx/lazy-resource-playground.git gh-pages \
    && rm -rf .git
  ```

- **StackBlitz** : https://stackblitz.com/github/flo-dmtx/lazy-resource-playground — le
  WebContainer fait `npm install` (le postinstall rejoue le patch) puis `npm start`.
  `STACKBLITZ_PROJECT` dans `demo-registry.ts` pilote les liens « edit ↗ » des figures
  (`?file=src/app/demo-*.ts&initialpath=/?demo=<name>`).
- **Gist** (le fichier userland seul, avec son README) :
  https://gist.github.com/flo-dmtx/e8c9ff69bec58adf85e902eab9f7d900

## Où est l'implémentation

- **Native (la PR)** : branche `feat/lazy-resource` sur flo-dmtx/angular ; ici sous forme du
  patch `patches/@angular+core+22.1.0.patch`, mêmes hunks portés sur le bundle publié.
- **Userland** : `src/app/lazy-resource.ts`, copie verbatim de
  `../lazy-resource/src/lazy-resource.ts` (aucune modification locale — tout correctif se
  fait là-bas puis se recopie ici).
