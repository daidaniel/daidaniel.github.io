# daidaniel.github.io

Personal website for Daniel Dai, built with [Astro](https://astro.build). A single-page, static site — no client-side JavaScript.

## Commands

| Command        | Action                                       |
| -------------- | -------------------------------------------- |
| `pnpm install` | Install dependencies                         |
| `pnpm dev`     | Start the dev server at `localhost:4321`     |
| `pnpm build`   | Build the production site into `dist/`       |
| `pnpm preview` | Preview the production build locally         |
| `pnpm check`   | Type-check the project (`astro check`)       |

## Structure

```
├── .github/workflows/deploy.yml   GitHub Pages deployment
├── public/
│   ├── DanielDai-Resume.pdf       Résumé (served at /DanielDai-Resume.pdf)
│   └── favicon.svg
├── src/
│   ├── assets/qk65.png            Keyboard photo (optimized at build time)
│   ├── layouts/Base.astro         Shared head and footer
│   ├── pages/                     index.astro and 404.astro
│   └── styles/global.css          Palette variables and base styles
└── astro.config.mjs               Site URL and self-hosted Inter font
```

## Deployment

Pushing to `master` builds and deploys the site via GitHub Actions
(`.github/workflows/deploy.yml`). The repository's **Settings → Pages → Source**
must be set to **GitHub Actions**.
