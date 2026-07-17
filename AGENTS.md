## Conventions

- pnpm is the package manager. Deploys to GitHub Pages from `master` via `.github/workflows/deploy.yml`.
- Static site; every page except `/orbit` ships zero client-side JavaScript — animations (type-out title, fade-up) are pure CSS custom utilities in `src/styles/global.css`; the keyboard's long shadow is baked into `src/assets/shadow.svg`.
- Pages compose full-viewport blocks from `src/components/Section.astro` (min one window tall, content centered; add a `<Section>` in `index.astro` to add a section). The hero's down arrow is a plain anchor + CSS `scroll-behavior: smooth`.
- Styling is Tailwind v4 utility classes; format with Prettier (`prettier-plugin-astro`, configured in `package.json`).

## Architecture

The site is `src/layouts/Base.astro` (head, self-hosted fonts, OG tags, build-time footer year) wrapping two pages — `src/pages/index.astro` and `404.astro` — plus two small shared components, `Section.astro` and `TextLink.astro`. A third page, `src/pages/orbit.astro`, is a standalone document outside `Base.astro`. The non-obvious, cross-file details:

- **Orbit game:** `/orbit` (`src/pages/orbit.astro` + `src/scripts/orbit.ts`, Phaser 3.90) is the one page with client-side JS. Mechanics, physics, the `CONFIG` tuning block, and the verification approach: `docs/orbit.md`.

- **Type-out title:** the `<h1>` in `index.astro` sets `[--type-chars:N]`, which must equal the exact character count of the title text (10 for "Daniel Dai"). The `type-out` utility in `global.css` drives both the typing `steps()` and the `ch` width from that number — change the text and you must update N, or the animation and cursor width break.
- **Keyboard + shadow:** `index.astro` stacks `keyboard.svg` over `shadow.svg` (the long shadow is pre-baked into that SVG). The two are bottom-left aligned and the shadow `<img>` is width-scaled by `2196/1979` — the ratio of the two SVG canvases — so they share units-per-pixel. Preserve that ratio when touching the figure's widths/margins; the inline comments encode the rest of the clip/bleed math.
- **OG image:** `Base.astro` generates `og:image` at build from `src/assets/share.png` via `getImage({ format: "jpg" })` (this is why `sharp` is a dependency). Astro's `<Image>` passes SVGs through un-rasterized, so the on-page keyboard SVG ships as-is — only `share.png` is processed.
- **Footer year** is build-time (`getFullYear()`); a Jan 1 cron in `deploy.yml` rebuilds the site so the year rolls over without a push.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

`pnpm check` (`astro check`) type-checks `.astro` and `.ts` files — there are no tests. `pnpm build` outputs to `dist/`. For `/orbit`, follow `docs/orbit.md` → Verification.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
