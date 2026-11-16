# Fonts

Every face Kurumi ships is under the SIL Open Font License 1.1; the licence
texts are in `licenses/`. None is fetched from a font service at runtime.

| Face | Used for | Files | Source | Version |
|------|----------|-------|--------|---------|
| Geist | The interface; editor option | `Geist-Variable.woff2` | github.com/vercel/geist-font | 1.400 |
| Geist Mono | Code | `GeistMono-Variable.woff2` | github.com/vercel/geist-font | 1.400 |
| iA Writer Quattro S | Editor (default) | `iAWriterQuattroS-*.woff2` | github.com/iaolo/iA-Fonts | 2.000 |
| Newsreader | Editor option | `optional/Newsreader-Variable.woff2`, `optional/Newsreader-Italic-Variable.woff2` | github.com/productiontype/Newsreader, commit cfcb4f7 | 1.003 |
| Atkinson Hyperlegible Next | Editor option | `optional/AtkinsonHyperlegibleNext-Variable.woff2`, `optional/AtkinsonHyperlegibleNext-Italic-Variable.woff2` | github.com/googlefonts/atkinson-hyperlegible-next, commit 7925f50 | 2.001 |

Newsreader: the repository's variable TTFs (`fonts/variable/ttf/`, axes
`opsz` 6–72 and `wght` 200–800), compressed to WOFF2 with fontTools 4.60.2,
glyphs and axes untouched. Atkinson Hyperlegible Next: the repository's own
`fonts/webfonts/*.woff2` (`wght` 200–800), unchanged.

`optional/` is not part of the offline app shell: a face from there is
downloaded when someone chooses it in Settings → Appearance and kept in the
`kurumi-fonts` cache (`src/lib/editor-fonts.ts`, `vite.config.ts`).
