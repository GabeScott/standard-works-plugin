# 📖 Standard Works Plugin

An Obsidian plugin to supercharge your scripture study with structured links, commentary, and intelligent backlinks — all centered around the **Standard Works** of the LDS Church.

---

## ✨ Features

- 🔗 **Generate wiki links to scripture verses**  
  Easily convert scripture references into Obsidian-style `[[wiki links]]` that point to your verse-level notes.

- 📚 **Read scripture commentary from a local SQLite database**  
  View doctrinal commentary, quotes, or notes stored in a `.db` file right inside Obsidian.

- 🧭 **Sort backlinks in scripture order**  
  Automatically organize verse backlinks in canonical order (e.g. Genesis → Exodus → Leviticus), not just by filename.

---

## 🛠 Installation

### Manual

1. Clone or download this repository.
2. Build the plugin with `npm install && npm run build`.
3. Copy `main.js`, and `manifest.json` into your Obsidian vault's plugin folder:  
   `.obsidian/plugins/standard-works-plugin/`
4. Enable the plugin in Obsidian under **Settings → Community Plugins**.

---

## 🗃️ Database Requirements

This plugin reads from a local SQLite database (`.db` file) that includes:
- A `verse` table or equivalent with scripture references
- Optional commentary, metadata, and cross-references

Place your `.db` file inside your Obsidian vault. The plugin will attempt to load it on startup.

---

## 🔍 Example Use Case

Say you're studying **Alma 37:6**. The plugin can:
- Convert `Alma 37:6` into a link: `[[Alma 37:6]]`
- Display commentary or insights for that verse from your database
- Show backlinks like `[[Come, Follow Me Notes]] → Alma 37:6` in scripture order

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

