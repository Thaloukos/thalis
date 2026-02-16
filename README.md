# thalis

A terminal-themed personal website. Navigate pages using familiar shell commands like `ls`, `cd`, and `cat`.

## Stack

- Vanilla HTML, CSS, JavaScript (ES modules)
- No frameworks or dependencies
- Manifest-driven filesystem (`manifest.json` auto-generated from directory structure)
- Terminal emulator split into [focused modules](terminal/)

## Running locally

```
npx serve
```

## Adding content

- **New page**: Create `pages/Name.txt`, run `node scripts/build-manifest.js`
- **New subpage**: Create `pages/Page/name.txt`, run `node scripts/build-manifest.js`
- **Reorder subpages**: Create `pages/Page/.order` with one name per line
- **New executable**: Create `executables/Page/name.js` (ES module exporting `start`, `stop`, `handleResize`), optionally `name.txt` for help text
- **Page links in content**: Use `[link text](~/Path)` syntax in `.txt` files
- **Conditional text**: Use `{{desktop text}{mobile text}}` in `.txt` files to show different content per device
- **Hide pages on mobile**: Add page name to `pages/.mobile-hidden`
- **Hide executables on mobile**: Add executable name to `executables/Page/.mobile-hidden`

## OG image

The link preview image is generated from `og-image.svg`. To regenerate the PNG:

```
brew install librsvg
./generate-og-image.sh
```

## License

MIT