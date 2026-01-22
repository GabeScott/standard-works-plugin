import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, Editor, MarkdownView, Menu, TFile, ItemView, WorkspaceLeaf} from "obsidian";
import initSqlJs, { Database, SqlJsStatic } from "sql.js";

interface ScriptureData {
	[book: string]: {
		heading?: string;
		[chapter: string]: {
			[verse: string]: string;
		} | string;
	};
}

interface SqlitePluginSettings {
	orderBacklinks: boolean;
}

const DEFAULT_SETTINGS: SqlitePluginSettings = {
	orderBacklinks: true
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

const VIEW_TYPE_SCRIPTURE_CONTEXT = "scripture-context-view";

class ScriptureContextView extends ItemView {
	private plugin: SqlitePlugin;
	private contentEl: HTMLElement;
	private contentContainer: HTMLElement;
	private isUpdating: boolean = false;
	private currentFile: string | null = null;
	private currentBook: string | null = null;
	private currentChapter: string | null = null;
	private currentVerse: string | null = null;
	private updateOnFileChange: boolean = true;

	constructor(leaf: WorkspaceLeaf, plugin: SqlitePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_SCRIPTURE_CONTEXT;
	}

	getDisplayText(): string {
		return "Scripture Context Viewer";
	}

	getIcon(): string {
		return "book-open";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		this.contentEl = container.createDiv();
		this.contentEl.style.height = "100%";
		this.contentEl.style.display = "flex";
		this.contentEl.style.flexDirection = "column";
		
		// Create header with toggle
		const headerEl = this.contentEl.createDiv({ cls: "scripture-context-header" });
		headerEl.style.display = "flex";
		headerEl.style.justifyContent = "space-between";
		headerEl.style.alignItems = "center";
		headerEl.style.padding = "10px";
		headerEl.style.paddingRight = "15px";
		headerEl.style.borderBottom = "1px solid var(--background-modifier-border)";
		headerEl.style.flexShrink = "0";
		
		const titleEl = headerEl.createEl("h4", { text: "Scripture Context" });
		titleEl.style.margin = "0";
		
		const toggleContainer = headerEl.createDiv();
		toggleContainer.style.display = "flex";
		toggleContainer.style.alignItems = "center";
		toggleContainer.style.gap = "8px";
		
		const toggleLabel = toggleContainer.createEl("span", { text: "Update on file change" });
		toggleLabel.style.fontSize = "0.9em";
		toggleLabel.style.color = "var(--text-muted)";
		
		const toggleInput = toggleContainer.createEl("input", {
			attr: { type: "checkbox", checked: this.updateOnFileChange }
		});
		toggleInput.style.cursor = "pointer";
		
		toggleInput.addEventListener("change", () => {
			this.updateOnFileChange = toggleInput.checked;
		});
		
		// Create content container that will be updated
		this.contentContainer = this.contentEl.createDiv({ cls: "scripture-context-content" });
		this.contentContainer.style.flex = "1";
		this.contentContainer.style.overflowY = "auto";
		this.contentContainer.style.padding = "10px";
		
		// Register event to update when active file changes
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.updateContext();
			})
		);
		
		// Initial update
		this.updateContext();
	}

	async updateContext(): Promise<void> {
		if (!this.contentContainer || this.isUpdating) return;
		
		// Check if automatic updates are enabled
		if (!this.updateOnFileChange) return;
		
		const activeFile = this.app.workspace.getActiveFile();
		const currentFilePath = activeFile?.path || null;
		
		// Only update if the file has actually changed
		if (currentFilePath === this.currentFile) return;
		
		this.currentFile = currentFilePath;
		
		if (!activeFile) {
			// Don't update the panel when there's no active file
			return;
		}
		
		// Parse the filename to extract book, chapter, and verse
		// Expected format: "Book Name Chapter.Verse" (e.g., "1 Nephi 3.7")
		const filename = activeFile.basename;
		const match = filename.match(/^(.+?)\s+(\d+)\.(\d+)$/);
		
		if (!match) {
			// Not a scripture file, keep the current content
			return;
		}
		
		const bookName = match[1];
		const chapter = match[2];
		const verse = match[3];
		
		// Check if we're in the same chapter - if so, just update highlighting
		if (bookName === this.currentBook && chapter === this.currentChapter) {
			this.currentVerse = verse;
			this.updateHighlighting(verse);
			return;
		}
		
		// Different chapter - do full reload
		this.isUpdating = true;
		this.currentBook = bookName;
		this.currentChapter = chapter;
		this.currentVerse = verse;
		
		try {
			this.contentContainer.empty();
			
			// Determine which JSON file to load based on the book
			const dataFile = this.getDataFileForBook(bookName);
			if (!dataFile) {
				this.contentContainer.createEl("p", { text: `Unknown book: ${bookName}` });
				return;
			}
			
			try {
				// Load the JSON data
				const dataPath = `data/${dataFile}`;
				const adapter = this.app.vault.adapter;
				const basePath = (this.plugin.manifest as any).dir;
				const fullPath = `${basePath}/${dataPath}`;
				
				const jsonContent = await adapter.read(fullPath);
				const scriptureData: ScriptureData = JSON.parse(jsonContent);
				
				// Get the chapter data
				if (!scriptureData[bookName] || !scriptureData[bookName][chapter]) {
					this.contentContainer.createEl("p", { text: `Chapter ${chapter} not found in ${bookName}` });
					return;
				}
				
				const chapterData = scriptureData[bookName][chapter] as { [verse: string]: string };
				
				// Display current verse info
				const currentVerseEl = this.contentContainer.createDiv({ cls: "current-verse" });
				const chapterTitle = currentVerseEl.createEl("h5", { text: `${bookName} ${chapter}` });
				chapterTitle.style.userSelect = "text";
				chapterTitle.style.cursor = "text";
				
				// Display chapter heading if available
				const heading = scriptureData[bookName].heading;
				if (heading && typeof heading === "string") {
					const headingEl = this.contentContainer.createDiv({ cls: "chapter-heading" });
					const headingText = headingEl.createEl("em", { text: heading });
					headingEl.style.marginBottom = "10px";
					headingEl.style.fontSize = "0.9em";
					headingEl.style.color = "var(--text-muted)";
					headingEl.style.userSelect = "text";
					headingEl.style.cursor = "text";
				}
				
				// Display all verses in the chapter
				const versesContainer = this.contentContainer.createDiv({ cls: "chapter-verses" });
				versesContainer.style.marginTop = "10px";
				
				const verseNumbers = Object.keys(chapterData).sort((a, b) => parseInt(a) - parseInt(b));
				for (const verseNum of verseNumbers) {
					const verseEl = versesContainer.createDiv({ cls: "verse-item" });
					verseEl.style.marginBottom = "10px";
					verseEl.style.padding = "5px";
					verseEl.style.userSelect = "text";
					verseEl.style.cursor = "text";
					
					// Highlight the current verse
					if (verseNum === verse) {
						verseEl.style.backgroundColor = "var(--background-modifier-border)";
						verseEl.style.borderLeft = "3px solid var(--interactive-accent)";
						verseEl.style.paddingLeft = "10px";
						
						// Scroll to the current verse after a short delay to ensure DOM is ready
						setTimeout(() => {
							verseEl.scrollIntoView({ behavior: "smooth", block: "center" });
						}, 500);
					}
					
					const verseNumEl = verseEl.createEl("strong", { text: `${verseNum}. ` });
					verseNumEl.style.marginRight = "5px";
					verseEl.createSpan({ text: chapterData[verseNum] });
				}
				
			} catch (error) {
				console.error("Error loading scripture context:", error);
				this.contentContainer.createEl("p", { text: `Error loading context: ${error.message}` });
			}
		} finally {
			this.isUpdating = false;
		}
	}

	private getDataFileForBook(bookName: string): string | null {
		// Map book names to their JSON files
		const bookToFile: { [key: string]: string } = {
			// Book of Mormon
			"1 Nephi": "bom.json",
			"2 Nephi": "bom.json",
			"Jacob": "bom.json",
			"Enos": "bom.json",
			"Jarom": "bom.json",
			"Omni": "bom.json",
			"Words of Mormon": "bom.json",
			"Mosiah": "bom.json",
			"Alma": "bom.json",
			"Helaman": "bom.json",
			"3 Nephi": "bom.json",
			"4 Nephi": "bom.json",
			"Mormon": "bom.json",
			"Ether": "bom.json",
			"Moroni": "bom.json",
			// Old Testament
			"Genesis": "ot.json",
			"Exodus": "ot.json",
			"Leviticus": "ot.json",
			"Numbers": "ot.json",
			"Deuteronomy": "ot.json",
			"Joshua": "ot.json",
			"Judges": "ot.json",
			"Ruth": "ot.json",
			"1 Samuel": "ot.json",
			"2 Samuel": "ot.json",
			"1 Kings": "ot.json",
			"2 Kings": "ot.json",
			"1 Chronicles": "ot.json",
			"2 Chronicles": "ot.json",
			"Ezra": "ot.json",
			"Nehemiah": "ot.json",
			"Esther": "ot.json",
			"Job": "ot.json",
			"Psalms": "ot.json",
			"Proverbs": "ot.json",
			"Ecclesiastes": "ot.json",
			"Song of Solomon": "ot.json",
			"Isaiah": "ot.json",
			"Jeremiah": "ot.json",
			"Lamentations": "ot.json",
			"Ezekiel": "ot.json",
			"Daniel": "ot.json",
			"Hosea": "ot.json",
			"Joel": "ot.json",
			"Amos": "ot.json",
			"Obadiah": "ot.json",
			"Jonah": "ot.json",
			"Micah": "ot.json",
			"Nahum": "ot.json",
			"Habakkuk": "ot.json",
			"Zephaniah": "ot.json",
			"Haggai": "ot.json",
			"Zechariah": "ot.json",
			"Malachi": "ot.json",
			// New Testament
			"Matthew": "nt.json",
			"Mark": "nt.json",
			"Luke": "nt.json",
			"John": "nt.json",
			"Acts": "nt.json",
			"Romans": "nt.json",
			"1 Corinthians": "nt.json",
			"2 Corinthians": "nt.json",
			"Galatians": "nt.json",
			"Ephesians": "nt.json",
			"Philippians": "nt.json",
			"Colossians": "nt.json",
			"1 Thessalonians": "nt.json",
			"2 Thessalonians": "nt.json",
			"1 Timothy": "nt.json",
			"2 Timothy": "nt.json",
			"Titus": "nt.json",
			"Philemon": "nt.json",
			"Hebrews": "nt.json",
			"James": "nt.json",
			"1 Peter": "nt.json",
			"2 Peter": "nt.json",
			"1 John": "nt.json",
			"2 John": "nt.json",
			"3 John": "nt.json",
			"Jude": "nt.json",
			"Revelation": "nt.json",
			// D&C
			"D&C": "dac.json",
			"Official Declaration": "dac.json",
			// Pearl of Great Price
			"Moses": "pogp.json",
			"Abraham": "pogp.json",
			"Joseph Smith Matthew": "pogp.json",
			"Joseph Smith History": "pogp.json",
			"Articles of Faith": "pogp.json"
		};
		
		return bookToFile[bookName] || null;
	}

	private updateHighlighting(newVerse: string): void {
		// Find all verse items in the current chapter
		const versesContainer = this.contentContainer.querySelector(".chapter-verses") as HTMLElement;
		if (!versesContainer) return;
		
		const verseItems = versesContainer.querySelectorAll(".verse-item");
		let targetVerse: HTMLElement | null = null;
		
		verseItems.forEach((verseEl) => {
			const verseNumEl = verseEl.querySelector("strong");
			if (!verseNumEl) return;
			
			// Extract verse number from the text (e.g., "7. " -> "7")
			const verseNum = verseNumEl.textContent?.replace(".", "").trim();
			
			if (verseNum === newVerse) {
				// Highlight this verse
				(verseEl as HTMLElement).style.backgroundColor = "var(--background-modifier-border)";
				(verseEl as HTMLElement).style.borderLeft = "3px solid var(--interactive-accent)";
				(verseEl as HTMLElement).style.paddingLeft = "10px";
				targetVerse = verseEl as HTMLElement;
			} else {
				// Remove highlighting from other verses
				(verseEl as HTMLElement).style.backgroundColor = "";
				(verseEl as HTMLElement).style.borderLeft = "";
				(verseEl as HTMLElement).style.paddingLeft = "5px";
			}
		});
		
		// Scroll to the target verse after updating all styles
		if (targetVerse) {
			// Calculate the scroll position manually to avoid interruption
			requestAnimationFrame(() => {
				if (!targetVerse || !versesContainer) return;
				
				const containerRect = versesContainer.getBoundingClientRect();
				const targetRect = targetVerse.getBoundingClientRect();
				const relativeTop = targetRect.top - containerRect.top;
				const scrollTarget = versesContainer.scrollTop + relativeTop - (containerRect.height / 2) + (targetRect.height / 2);
				
				// Use smooth scroll on the container
				versesContainer.scrollTo({
					top: scrollTarget,
					behavior: "smooth"
				});
			});
		}
	}

	async onClose(): Promise<void> {
		// Clean up when view is closed
	}
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

		// Register the custom view
		this.registerView(
			VIEW_TYPE_SCRIPTURE_CONTEXT,
			(leaf) => new ScriptureContextView(leaf, this)
		);

		// Add command to open the custom view
		this.addCommand({
			id: "open-scripture-context-view",
			name: "Open Scripture Context View",
			callback: () => {
				this.activateView();
			}
		});

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
			id: "go-to-verse",
			name: "Go to verse",
			callback: () => {
				new GoToVerseModal(this.app, (reference: string) => {
					this.goToVerse(reference);
				}).open();
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
		
		// Open Scripture Context View by default
		this.activateView();
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
		// Check if ordering is enabled
		if (!this.settings.orderBacklinks) {
			return;
		}

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

	async activateView() {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_SCRIPTURE_CONTEXT)[0];

		if (!leaf) {
			// Create new leaf in right sidebar
			leaf = workspace.getRightLeaf(false);
			await leaf.setViewState({
				type: VIEW_TYPE_SCRIPTURE_CONTEXT,
				active: true,
			});
		}

		// Reveal the leaf
		workspace.revealLeaf(leaf);
	}

	onunload() {
		this.db?.close();
		this.db = null;
		this.observer.disconnect();

		// Clean up the custom view
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_SCRIPTURE_CONTEXT);
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
			const adapter = this.app.vault.adapter;
			const basePath = (this.manifest as any).dir;
			const fullPath = `${basePath}/data/commentary.db`;
			
			const data = await adapter.readBinary(fullPath);
			const uInt8Array = new Uint8Array(data);
			this.db = new this.SQL.Database(uInt8Array);
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

	private goToVerse(reference: string) {
		if (!reference || !reference.trim()) {
			new Notice("Please enter a verse reference");
			return;
		}

		// Parse the reference (e.g., "John 3:16", "1 Nephi 3:7")
		const trimmedRef = reference.trim();
		
		// Extract book, chapter, and verse
		let book = "";
		let chapter = "";
		let verse = "";
		
		if (trimmedRef.includes(":")) {
			// Format: "Book Chapter:Verse"
			const parts = trimmedRef.split(" ");
			const lastPart = parts[parts.length - 1];
			const chapterVerse = lastPart.split(":");
			
			book = parts.slice(0, -1).join(" ");
			chapter = chapterVerse[0];
			verse = chapterVerse[1];
		} else {
			new Notice("Invalid format. Use 'Book Chapter:Verse' (e.g., 'John 3:16')");
			return;
		}
		
		// Expand abbreviations
		for (const [key, value] of Object.entries(abbreviations)) {
			if (book.includes(key)) {
				book = book.replace(key, value);
				break;
			}
		}
		
		// Format the filename
		const filename = `${book} ${chapter}.${verse}`;
		
		// Check if file exists
		const files = this.app.vault.getFiles();
		let targetFile: TFile | null = null;
		
		for (const file of files) {
			if (file.name === `${filename}.md`) {
				targetFile = file;
				break;
			}
		}
		
		if (!targetFile) {
			new Notice(`Verse not found: ${filename}`);
			return;
		}
		
		// Open the file
		this.app.workspace.getLeaf().openFile(targetFile);
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

class GoToVerseModal extends Modal {
	onSubmit: (reference: string) => void;

	constructor(app: App, onSubmit: (reference: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Go to verse" });

		const inputEl = contentEl.createEl("input", {
			type: "text",
			attr: { 
				placeholder: "e.g., John 3:16",
				style: "width: 100%; margin-bottom: 10px; box-sizing: border-box;"
			}
		});
		
		// Auto-focus
		inputEl.focus();
		
		inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				this.onSubmit(inputEl.value);
				this.close();
			}
		});

		const submitBtn = contentEl.createEl("button", { text: "Go" });
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
			.setName("Order Backlinks")
			.setDesc("Automatically sort backlinks by scripture reference order.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.orderBacklinks)
				.onChange(async (value) => {
					this.plugin.settings.orderBacklinks = value;
					await this.plugin.saveSettings();
				}));
	}
}
