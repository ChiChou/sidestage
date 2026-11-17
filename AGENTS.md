# Copy style

Do not use the middle dot character (Unicode U+00B7) in generated text, UI copy, documentation, or artwork unless the user explicitly asks for it. Use natural phrasing, commas, colons, or parentheses as appropriate.

# Store screenshots

Export Chrome Web Store screenshots as 24-bit PNG without alpha, 1280 by 800 pixels, never JPEG. `node store-assets/export.mjs` produces them from the lossless captures in `store-assets/source`; keep those captures lossless too. If a new screenshot is added, register it in `store-assets/export.mjs`, `store-assets/validate.mjs`, `store-assets/README.md` and `docs/store-listing.md`.
