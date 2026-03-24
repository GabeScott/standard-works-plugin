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
  - **Right-click context menu** to copy verse text, reference, or both, or open the verse note
  - **Hover highlighting** for easy verse identification
  - **Go-to-verse search bar** — type a reference like `John 3:16` or `John 3` to jump directly

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

### Manual

1. Clone or download this repository.
2. Copy the directory into your Obsidian vault's plugin folder:  
   `.obsidian/plugins/standard-works-plugin/`
3. Enable the plugin in Obsidian under **Settings → Community Plugins**. (May need to reload Obsidian)

---


## 🔍 Example Use Case

Say you're studying **Alma 37:6**. The plugin can:
- Convert `Alma 37:6` into a link in Obsidian format: `[[Alma 37.6|Alma 37:6]]`
- Display commentary or insights for that verse from your database
- Show backlinks like `[[Come, Follow Me Notes]] → Alma 37:6` in scripture order
- View the whole chapter on the side to easily read the context for the verse
- Click any verse in the context viewer to open its note
- Navigate to the previous or next chapter with one click
- Search the full text of all scriptures for any word or pattern
- Right-click a search result to insert a wiki link into your current note

---

## 🧪 Status

This plugin is under active development. Features and file formats may change. Contributions and feedback are welcome!

---

## 📄 License

MIT — see [LICENSE](./LICENSE) for details.

---

## 🙌 Acknowledgments

- Powered by [sql.js](https://github.com/sql-js/sql.js)
- Inspired by the Obsidian scripture study community

