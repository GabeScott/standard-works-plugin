import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, Editor, MarkdownView, Menu, TFile} from "obsidian";
import initSqlJs, { Database, SqlJsStatic } from "sql.js";

interface SqlitePluginSettings {
	dbPath: string;
}

const DEFAULT_SETTINGS: SqlitePluginSettings = {
	dbPath: "ldss.db"
};

const abbreviations = {
	"Gen.":"Genesis",
	"Ex.":"Exodus",
	"Lev.":"Leviticus",
	"Num.":"Numbers",
	"Deut.":"Deuteronomy",
	"Josh.":"Joshua",
	"Judg.":"Judges",
	"Ruth":"Ruth",
	"1 Sam.":"1 Samuel",
	"2 Sam.":"2 Samuel",
	"1 Kgs.":"1 Kings",
	"2 Kgs.":"2 Kings",
	"1 Chr.":"1 Chronicles",
	"2 Chr.":"2 Chronicles",
	"Ezra":"Ezra",
	"Neh.":"Nehemiah",
	"Esth.":"Esther",
	"Job":"Job",
	"Ps.":"Psalms",
	"Prov.":"Proverbs",
	"Eccl.":"Ecclesiastes",
	"Song":"Song of Solomon",
	"Isa.":"Isaiah",
	"Jer.":"Jeremiah",
	"Lam.":"Lamentations",
	"Ezek.":"Ezekiel",
	"Dan.":"Daniel",
	"Hosea":"Hosea",
	"Joel":"Joel",
	"Amos":"Amos",
	"Obad.":"Obadiah",
	"Jonah":"Jonah",
	"Micah":"Micah",
	"Nahum":"Nahum",
	"Hab.":"Habakkuk",
	"Zeph.":"Zephaniah",
	"Hag.":"Haggai",
	"Zech.":"Zechariah",
	"Mal.":"Malachi",
	"Matt.":"Matthew",
	"Mark":"Mark",
	"Luke":"Luke",
	"John":"John",
	"Acts":"Acts",
	"Rom.":"Romans",
	"1 Cor.":"1 Corinthians",
	"2 Cor.":"2 Corinthians",
	"Gal.":"Galatians",
	"Eph.":"Ephesians",
	"Philip.":"Philippians",
	"Col.":"Colossians",
	"1 Thes.":"1 Thessalonians",
	"2 Thes.":"2 Thessalonians",
	"1 Tim.":"1 Timothy",
	"2 Tim.":"2 Timothy",
	"Titus":"Titus",
	"Philem.":"Philemon",
	"Heb.":"Hebrews",
	"James":"James",
	"1 Pet.":"1 Peter",
	"2 Pet.":"2 Peter",
	"1 Jn.":"1 John",
	"2 Jn.":"2 John",
	"3 Jn.":"3 John",
	"Jude":"Jude",
	"Rev.":"Revelation",
	"1 Ne.":"1 Nephi",
	"2 Ne.":"2 Nephi",
	"Jacob":"Jacob",
	"Enos":"Enos",
	"Jarom":"Jarom",
	"Omni":"Omni",
	"W of M":"Words of Mormon",
	"Mosiah":"Mosiah",
	"Alma":"Alma",
	"Hel.":"Helaman",
	"3 Ne.":"3 Nephi",
	"4 Ne.":"4 Nephi",
	"Morm.":"Mormon",
	"Ether":"Ether",
	"Moro.":"Moroni",
	"D&C":"D&C",
	"OD":"Official Declaration",
	"Moses":"Moses",
	"Abr.":"Abraham",
	"JS—M":"Joseph Smith Matthew",
	"JS—H":"Joseph Smith History",
	"A of F":"Articles of Faith"
}

export default class SqlitePlugin extends Plugin {
	settings: SqlitePluginSettings;
	SQL: SqlJsStatic | null = null;
	db: Database | null = null;
	private observer: MutationObserver;

	async onload() {
		await this.loadSettings();
		await this.loadSqlJs();
		await this.loadDatabase();
		console.log("Loading LDSS Plugin");

		this.observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === "childList") {
					mutation.addedNodes.forEach((node) => {
						if (
							node instanceof HTMLElement &&
							node.matches("div.tree-item.search-result")
						) {
							const parent = node.parentElement;
							if (parent && parent.classList.contains("search-results-children")) {
								this.sortBacklinksSafely(parent);
							}
						}
					});
				}
			}
		});

		this.observer.observe(document.body, {
			childList: true,
			subtree: true,
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, view: MarkdownView) => {
				const selectedText = editor.getSelection().trim();
				const selectedTextFixed = " - " + selectedText.replace(":", ".")
				if (selectedText) {
					menu.addItem((item) =>
						item
							.setTitle(`Link to reference`)
							.setIcon("link")
							.onClick(async () => this.linkifySelectedText(editor))
					);
				}
			})
		);

		this.addCommand({
			id: "linkify-selected-text",
			name: "Linkify selected text",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.linkifySelectedText(editor);
			},
		});

		this.addCommand({
			id: "search-scripture-reference",
			name: "Search Scripture Reference",
			callback: () => {
				// Get current active file name as default reference
				const activeFile = this.app.workspace.getActiveFile();
				var defaultReference = activeFile ? activeFile.basename : "";

				// Split the filename after the hyphen
				defaultReference = defaultReference.replace(".", ":") // Replace ":" with "."
				// Remove any leading or trailing whitespace
				
				new ReferenceSearchModal(this.app, defaultReference, async (reference: string) => {
					if (!this.db) {
						new Notice("Database not loaded.");
						return;
					}
					try {
						const query = `SELECT content FROM ldss WHERE reference = '${reference}'`;
						const result = this.db.exec(query);
						
						if (result.length === 0 || result[0].values.length === 0) {
							new ResultsModal(this.app, `No results found for reference: ${reference}`).open();
						} else {
							const content = result[0].values[0][0] as string;
							new ResultsModal(this.app, `Reference: ${reference}\n\n${content}`).open();
						}
					} catch (err) {
						console.error("Scripture search error:", err);
						new Notice("Error searching for reference.");
					}
				}).open();
			}
		});

		this.addCommand({
			id: "search-scripture-reference-auto",
			name: "Search Scripture Reference for Current File",
			callback: async () => {
				this.displayResults();
			}
		});

		this.addSettingTab(new SqlitePluginSettingTab(this.app, this));
	}

	private async displayResults(tries: number = 0) {
		// Get current active file name as default reference
		const activeFile = this.app.workspace.getActiveFile();
		var defaultReference = activeFile ? activeFile.basename : "";

		defaultReference = defaultReference.replace(".", ":") // Replace ":" with "."
		// Remove any leading or trailing whitespace
		const query = `SELECT content FROM ldss WHERE reference = '${defaultReference}'`;
		try{
			const result = this.db.exec(query);
			if (result.length === 0 || result[0].values.length === 0) {
				new ResultsModal(this.app, `No results found for reference: ${defaultReference}`).open();
			} else {
				const content = result[0].values[0][0] as string;
				new ResultsModal(this.app, `Reference: ${defaultReference}\n\n${content}`).open();
			}
		} catch (err) {
			await this.loadDatabase();
			tries++;
			if (tries > 3) {
				new Notice("Error searching for reference.");
				return;
			}
			this.displayResults(tries);
		}
	}

	private sortBacklinksSafely(container: Element) {
		// Prevent recursive triggering
		this.observer.disconnect();

		try {
			var items = Array.from(
				container.querySelectorAll("div.tree-item.search-result")
			);
			
			if (items.length < 2) return;
			var gc_itmes = []
			var tg_items = []
			var verses = []

			for (const item of items) {
				const textContent = item.querySelector("div.search-result-file-title")?.textContent || "";
				if(textContent.includes("April") || textContent.includes("October")) {
					gc_itmes.push(item)
				}
				else if (textContent.includes(".")) {
					verses.push(item)
				}
				else {
					tg_items.push(item)
				}
			}

			gc_itmes.sort((a, b) => {
				const atextContent = a.querySelector("div.search-result-file-title")?.textContent || "";
				const btextContent = b.querySelector("div.search-result-file-title")?.textContent || "";
				return btextContent.localeCompare(atextContent);
			});

			tg_items.sort((a, b) => {
				const atextContent = a.querySelector("div.search-result-file-title")?.textContent || "";
				const btextContent = b.querySelector("div.search-result-file-title")?.textContent || "";
				return atextContent.localeCompare(btextContent);
			});


			// Sort by text content
			verses.sort((a, b) => {

				var aBookInt = -1;
				var bBookInt = -1;
				const atextContent = a.querySelector("div.search-result-file-title")?.textContent || "";
				const btextContent = b.querySelector("div.search-result-file-title")?.textContent || "";
				const aBookStr = atextContent.split(' ').slice(0, -1).join(' ') || "";
				const bBookStr = btextContent.split(' ').slice(0, -1).join(' ') || "";
				const aChapter = parseInt(a.textContent?.split(' ').slice(-1)[0].split(':')[0] || "");
				const bChapter = parseInt(b.textContent?.split(' ').slice(-1)[0].split(':')[0] || "");
				const aVerse = parseInt(a.textContent?.split(' ').slice(-1)[0].split(':')[1] || "");
				const bVerse = parseInt(b.textContent?.split(' ').slice(-1)[0].split(':')[1] || "");
				var i = 0;
				for (const [key, value] of Object.entries(abbreviations)) {
					if (aBookStr == value) {
						aBookInt = i;
						break;
					}
					i++;
				}
				i = 0;
				for (const [key, value] of Object.entries(abbreviations)) {
					if (bBookStr == value) {
						bBookInt = i;
						break;
					}
					i++;
				}
				const aText = `${aBookInt} ${a.textContent?.toLowerCase() || ""}`;
				const bText = `${bBookInt} ${b.textContent?.toLowerCase() || ""}`;
				if (aBookInt > bBookInt){
					return 1;
				}
				else if (aBookInt < bBookInt){
					return -1;
				}
				else if (aChapter > bChapter) {
					return 1;
				} 
				else if (aChapter < bChapter) {
					return -1;
				}
				else if (aVerse > bVerse) {
					return 1;
				} else if (aVerse < bVerse) {
					return -1;
				}
				return aText.replace(aBookStr, "").localeCompare(bText.replace(bBookStr, ""));
			});

			// Clear items
			for (const item of items) {
				container.removeChild(item);
			}
			 // Add verses first
			for (const item of verses) {
				container.appendChild(item);
			}
			// Add TG items
			for (const item of tg_items) {
				container.appendChild(item);
			}
			// Add GC items
			for (const item of gc_itmes) {
				container.appendChild(item);
			}

		} finally {
			// Reconnect after sorting
			this.observer.observe(document.body, {
				childList: true,
				subtree: true,
			});
		}
	}

	onunload() {
		this.db?.close();
		this.db = null;
		this.observer.disconnect();
	}

	async loadSqlJs() {
		this.SQL = await initSqlJs({
			locateFile: file => `https://sql.js.org/dist/sql-wasm.wasm`,
		});
	}

	async loadDatabase() {
		if (!this.SQL) {
		
			new Notice("SQL.js not loaded. Please reload the plugin.");
			return;
		}

		try {
			const file = this.app.vault.getAbstractFileByPath(this.settings.dbPath);
			if (file instanceof TFile) {
				const data = await this.app.vault.readBinary(file);
                const uInt8Array = new Uint8Array(data);
				this.db = new this.SQL.Database(uInt8Array);				
				// You can now use a SQLite WASM library like sql.js to read this data
			} else {
				console.error("Could not find .db file in vault root.");
			}
		} catch (err) {
			console.error("Failed to read or parse database file:", err);
			new Notice("Failed to load SQLite DB.");
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private fileExists(filename: string): TFile | null {
		const files = this.app.vault.getFiles();
		filename = filename + ".md";
		for (const file of files) {
			if (file.name === filename) {
				return true; // returns the TFile object if found
			}
		}
		new Notice("File not found: " + filename);
		return false;
	}

	private getNumVerses(book: string, chapter: string): string[] {
		var verses = [];
		var final_verse = 0;
		const files = this.app.vault.getFiles();
		for (const file of files) {
			if (file.name.startsWith(`${book} ${chapter}.`)) {
				var verse = file.name.split(".")[1];
				if(parseInt(verse) > final_verse){
					final_verse = parseInt(verse);
				}
			}
		}
		if(final_verse == 0){
			new Notice(`Chapter not found: ${book} ${chapter}`);
			return [];
		}
		for (let i = 1; i <= final_verse; i++) {
			verses.push(i.toString());
		}
		return verses;
	}

	private linkifySelectedText(editor: Editor) {
		const selectedText = editor.getSelection().trim();
		var selectedTextFixed = selectedText

		// Get all the words except the last one
		var book = selectedText.split(" ").slice(0, -1).join(" ");
		for (const [key, value] of Object.entries(abbreviations)) {
			if (book.includes(key)) {
				book = book.replace(key, value);
				break;
			}
		}

		var chapter = "";
		var verses = [];

		if (!selectedText.includes(":")) {
			chapter = selectedText.split(" ").slice(-1)[0];
			verses = this.getNumVerses(book, chapter);
		}
		else{
			chapter = selectedText.split(" ").slice(-1)[0].split(":")[0];
			verses = selectedText.split(" ").slice(-1)[0].split(":")[1].split(",").map((v: string) => v.trim());
		}

		var finishedFirst = false;

		for (const verse of verses) {
			
			if (verse.includes("-")) {
				const [start, end] = verse.split("-");
				for (let i = parseInt(start); i <= parseInt(end); i++) {
					console.log(i);
					const filename = `${book} ${chapter}.${i}`;
					if(this.fileExists(filename)){
						if(finishedFirst)
							selectedTextFixed += `[[${filename}|]]`;
						else{
							selectedTextFixed = `[[${filename}|${selectedText}]]`;
							finishedFirst = true;
						}
					}
				}
			} else {
				const filename = `${book} ${chapter}.${verse}`;
				if(this.fileExists(filename)){
					if(finishedFirst)
						selectedTextFixed += `[[${filename}|]]`;
					else{
						selectedTextFixed = `[[${filename}|${selectedText}]]`;
						finishedFirst = true;
					}
				}
			}
			
		}

		if (!selectedTextFixed) {
			new Notice("No text selected");
			return;
		}

		editor.replaceSelection(selectedTextFixed);

	}
}

class ResultsModal extends Modal {
	results: string;
	wordWrap: boolean = true;

	constructor(app: App, results: string) {
		super(app);
		this.results = results;
	}

	onOpen() {
		const { contentEl } = this;
		
		// Make modal wider to better accommodate text
		this.modalEl.style.width = "80%";
		this.modalEl.style.maxWidth = "800px";
		
		contentEl.createEl("h2", { text: "Query Results" });
		
		// Create controls div
		const controlsDiv = contentEl.createEl("div", { cls: "results-controls" });
		controlsDiv.style.marginBottom = "10px";
		
		// Add word wrap toggle
		const wrapToggleLabel = controlsDiv.createEl("label");
		const wrapToggle = wrapToggleLabel.createEl("input", {
			attr: { 
				type: "checkbox",
				checked: this.wordWrap
			}
		});
		wrapToggleLabel.append(" Word Wrap");
		
		// Create results container
		const resultsContainer = contentEl.createEl("div", { cls: "results-container" });
		resultsContainer.style.border = "1px solid var(--background-modifier-border)";
		resultsContainer.style.borderRadius = "4px";
		resultsContainer.style.backgroundColor = "var(--background-secondary)";
		
		// Create pre element for the content
		const pre = resultsContainer.createEl("pre", { text: this.results });
		pre.style.maxHeight = "500px";
		pre.style.overflowY = "auto";
		pre.style.overflowX = this.wordWrap ? "hidden" : "auto";
		pre.style.padding = "10px";
		pre.style.margin = "0";
		pre.style.fontFamily = "serif";
		pre.style.whiteSpace = this.wordWrap ? "pre-wrap" : "pre";
		pre.style.wordBreak = this.wordWrap ? "break-word" : "normal";
		pre.style.userSelect = "text";
		pre.style.cursor = "text";
		
		// Handle word wrap toggle
		wrapToggle.addEventListener("change", () => {
			this.wordWrap = wrapToggle.checked;
			pre.style.whiteSpace = this.wordWrap ? "pre-wrap" : "pre";
			pre.style.wordBreak = this.wordWrap ? "break-word" : "normal";
			pre.style.overflowX = this.wordWrap ? "hidden" : "auto";
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

class ReferenceSearchModal extends Modal {
	onSubmit: (reference: string) => void;
	defaultReference: string;

	constructor(app: App, defaultReference: string, onSubmit: (reference: string) => void) {
		super(app);
		this.defaultReference = defaultReference;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Enter Scripture Reference" });

		const inputEl = contentEl.createEl("input", {
			type: "text",
			attr: { 
				placeholder: "e.g., John 3:16",
				style: "width: 100%; margin-bottom: 10px;",
				value: this.defaultReference
			}
		});
		
		// Auto-focus and select all text in input
		inputEl.focus();
		inputEl.select();
		
		inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				this.onSubmit(inputEl.value);
				this.close();
			}
		});

		const submitBtn = contentEl.createEl("button", { text: "Search" });
		submitBtn.addEventListener("click", () => {
			this.onSubmit(inputEl.value);
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

class SqlitePluginSettingTab extends PluginSettingTab {
	plugin: SqlitePlugin;

	constructor(app: App, plugin: SqlitePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "SQLite Plugin Settings" });

		new Setting(containerEl)
			.setName("Database Path")
			.setDesc("Relative path to SQLite database file from your vault root.")
			.addText(text => text
				.setPlaceholder("ldss.db")
				.setValue(this.plugin.settings.dbPath)
				.onChange(async (value) => {
					this.plugin.settings.dbPath = value;
					await this.plugin.saveSettings();
				}));
	}
}
