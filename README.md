# Chris Kevin — AI Engineer

Portfolio site with three pages:

- **Home** — a real-time 3D solar system (Three.js): a shader sun, 3D "BU BU BUGGIN" letters orbiting on reflective rings, particles, bloom and light rays. It pulses to the music, and clicking anywhere sets off a supernova.
- **About** — a holographic ID card with a comic "BU BU BUGGIN" burst coming out of the photo's mouth.
- **Portfolio** — the hackathon promo reel, looping in sync with the site music, plus a custom cover.

## Run it locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Deploy

Every push to `main` builds the site and publishes it to GitHub Pages (see `.github/workflows/deploy.yml`).
One-time setup in the GitHub repo: **Settings → Pages → Source: GitHub Actions**.

## Media tools

- `npm run cutout` — removes the yellow background from the photos in `assets-src/` and writes `public/images/`.
- `node tools/strip-audio.mjs <in.mp4> <out.mp4>` — keeps only the video track (add `--keep=audio` for just the sound, `--info` to inspect). Lossless, no re-encoding.

## Credits

Music: "She Bugging (Whatchu Gonna Do)" by Khantrast, from the NYP × Alibaba Cloud Hackathon reel by @nyp_cloud. The song belongs to its rights holders.
