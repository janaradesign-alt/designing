# Small Rituals

A quiet daily habit app: morning to bedtime routines, an 18:6 fasting timer, a focus timer, and a weekly progress view. It installs on your phone like an app and works offline.

Your data is stored on the device in the browser (localStorage). Nothing is sent anywhere.

## Put it online (GitHub Pages)

This folder lives inside the `designing` repository.

1. On GitHub, open the repository's **Settings > Pages**.
2. Under **Build and deployment**, set Source to **Deploy from a branch**, choose `main` and `/ (root)`, then Save.
3. After a minute the app is live at `https://janaradesign-alt.github.io/designing/small-rituals/`.

## Install on your phone

- **iPhone (Safari):** open the link, tap Share, then **Add to Home Screen**.
- **Android (Chrome):** open the link, tap the menu, then **Install app**.

## Updating

Edit `index.html`, then change `VERSION` in `sw.js` (for example `v1` to `v2`) so installed copies refresh.

## Files

- `index.html` the whole app
- `manifest.webmanifest` name, colors and icons for installing
- `sw.js` offline support
- `icons/` app icons
