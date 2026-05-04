# 📖 Standard Works Plugin

An Obsidian plugin to supercharge your scripture study with structured links, commentary, and intelligent backlinks — all centered around the **Standard Works** of The Church of Jesus Christ of Latter-day Saints.

Designed to work with my [standard-works-vault](https://github.com/GabeScott/standard-works-vault).

---

## ✨ Features

- 🔗 **Generate wiki links to scripture verses**  
  Easily convert scripture references into Obsidian-style `[[wiki links]]` that point to your verse-level notes.

- 📚 **Read scripture commentary from a local SQLite database**  
  View doctrinal commentary, quotes, or notes stored in a `.db` file right inside Obsidian.

- 🧭 **Sort backlinks in scripture order**  
  Automatically organize verse backlinks in canonical order (e.g. Genesis → Exodus → Leviticus), not just by filename.

- 📖 **Scripture Context Viewer**  
  See the whole chapter displayed in a side panel, updated automatically as you navigate notes.
  - **Click any verse** to open its note file
  - **Previous / Next chapter navigation** that crosses book boundaries seamlessly
  - **Right-click context menu** to copy verse text, reference, wikilink (`[[Book Ch.V|Book Ch:V]]`), or reference + text; open the verse note; or search commentary for that verse directly
  - **Hover highlighting** for easy verse identification
  - **Go-to-verse search bar** — type a reference like `John 3:16` or `John 3` to jump directly
  - **Inline commentary panel** — the bottom half of the sidebar shows commentary for the current verse, with its own search bar and Prev/Next navigation by canonical order

- 🔎 **Go to Verse (Fuzzy Suggest)**  
  A SuggestModal-based command with fuzzy matching across all 1,584 chapters. Type a book/chapter and drill into individual verses with a colon.

- 🔍 **Full-Text Scripture Search**  
  Search across all five standard works with selectable filters (OT, NT, Book of Mormon, D&C, Pearl of Great Price).
  - **Regex / Wildcard mode** — toggle to use patterns like `faith*`, `\brepent\w+`, or any valid regex
  - **Keyboard navigation** — Arrow keys to browse results, Enter to open, Alt+Enter to insert link
  - **Right-click context menu** — Insert link, copy link, copy reference, copy verse text, or open note
  - Paginated results with highlighted matches
  - Search state persists across modal opens

---

## 🛠 Installation

### Community Plugin Store

Submission to the Obsidian Community Plugin Store is planned for a future release. For now, install manually using the steps below.

### Manual Install

1. Download or clone this repository.
2. Copy the `standard-works-plugin/` folder into your vault's plugin directory:
   `.obsidian/plugins/standard-works-plugin/`
3. In Obsidian, go to **Settings → Community Plugins**, disable Safe Mode if prompted, and enable **Standard Works Plugin**.
4. Reload Obsidian if the plugin does not appear immediately.

> **Note:** The plugin ships with `main.js`, `manifest.json`, and `styles.css`. Make sure all three files are present in the plugin folder.

<!-- TODO (blocked on SWP_0008): Add a reference to the commentary.db schema doc once it lands, so users know the expected database format. -->
<!-- TODO (blocked on SWP_0006): Add a note on translation data behavior once SWP_0006 is resolved. -->

---

## Standard Works Vault

This plugin is designed around the [Standard Works Vault](https://github.com/GabeScott/standard-works-vault) — a companion Obsidian vault containing one note per verse across all five standard works of The Church of Jesus Christ of Latter-day Saints. The plugin assumes the vault's filename conventions (e.g. `Alma 37.6.md` for Alma 37:6) when resolving links and sorting backlinks in canonical order.

You do not need the vault to use every feature, but the backlink sorter and verse-note navigation work best when your notes follow these conventions. If you don't have the vault, search for **"Standard Works Vault"** on [GitHub](https://github.com/GabeScott/standard-works-vault).

---

## Quickstart

After installing and enabling the plugin:

1. Open Obsidian and navigate to a verse note (e.g. `Alma 37.6.md`).
2. Click the book ribbon icon in the left sidebar to open the **Scripture Context View**.
3. The viewer displays the full chapter and highlights the current verse. Click any verse to open its note.
4. Use the **Go to Verse** command (Command Palette → "Go to Verse") to jump to any reference by typing it, e.g. `John 3:16`.
5. Right-click any verse in the viewer to copy its text, reference, or wiki link, or to search commentary for it.

---

## 🔍 Example Use Case

Say you're studying **Alma 37:6**. The plugin can:
- Convert `Alma 37:6` into a link in Obsidian format: `[[Alma 37.6|Alma 37:6]]`
- Display commentary or insights for that verse from your database
- Show backlinks like `[[Come, Follow Me Notes]] → Alma 37:6` in scripture order
- View the whole chapter on the side to easily read the context for the verse
- Click any verse in the context viewer to open its note
- Navigate to the previous or next chapter with one click
- Read inline commentary for the verse right in the sidebar, and step through adjacent verses with Prev/Next
- Search the full text of all scriptures for any word or pattern
- Right-click a search result to insert a wiki link into your current note

---

## Known Behavior

### Linkify and LDS abbreviations

The **Linkify scripture references** command splits text into sentences before scanning for references. LDS-style abbreviations that end with a period — such as `1 Ne.`, `Moro.`, or `D&C` — can be mistaken for sentence boundaries, causing a reference that spans the abbreviation to be missed.

**Workaround:** Set **Linkify: sentences to scan** to `2` or higher in the plugin settings. This tells the scanner to look back across more text, which covers most cases where an abbreviation splits a reference. Alternatively, select the text you want to linkify before running the command — Linkify always processes a manual selection in full, with no sentence splitting.

---

## 🧪 Status

This plugin is stable as of v1.0. Bug reports and feature suggestions are welcome via [GitHub Issues](https://github.com/GabeScott/standard-works-plugin/issues). Contributions and pull requests are always appreciated.

---

## 📄 License

MIT — see [LICENSE](./LICENSE) for details.

---

## 🙌 Acknowledgments

- Powered by [sql.js](https://github.com/sql-js/sql.js)
- Inspired by the Obsidian scripture study community

