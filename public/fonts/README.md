# Self-hosted typography assets

These Latin-subset WOFF2 files come from Fontsource npm packages. Package names,
exact versions, supported weight ranges, and content-hashed URLs are pinned in
`src/lib/typography/assets.json`. Each family has its upstream license alongside it.
Regenerate from the repository root with `python3 scripts/vendor-fonts.py` (npm
registry access required). No npm font package is a runtime dependency.

Variable normal faces are used for 21 families. Poppins and Lato use only the
available static weights used by the application (400–900); browser matching
handles weights a family doesn't supply. No italic or other language subsets are
preloaded; unsupported scripts fall back to installed system fonts. Fonts are
requested only when a selected family/weight is used. The settings dropdown can
load a single deliberately inspected family on demand, never all 23 at once.
