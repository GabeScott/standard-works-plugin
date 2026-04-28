import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, Editor, MarkdownView, Menu, TFile, ItemView, WorkspaceLeaf, SuggestModal} from "obsidian";
import initSqlJs, { Database, SqlJsStatic } from "sql.js";

interface ScriptureData {
	[book: string]: {
		heading?: string;
		[chapter: string]: {
			[verse: string]: string;
		} | string;
	};
}

interface StandardWorksPluginSettings {
	orderBacklinks: boolean;
	translationLanguages: string[];
	linkifySentencesToScan: number;
}

const DEFAULT_SETTINGS: StandardWorksPluginSettings = {
	orderBacklinks: true,
	translationLanguages: ["eng"],
	linkifySentencesToScan: 1,
};

// Single source of truth: groups books by data file, preserving canonical scripture order
const BOOKS_BY_FILE: Record<string, Record<string, string>> = {
	"ot.json": {
		"Gen.": "Genesis", "Ex.": "Exodus", "Lev.": "Leviticus", "Num.": "Numbers",
		"Deut.": "Deuteronomy", "Josh.": "Joshua", "Judg.": "Judges", "Ruth": "Ruth",
		"1 Sam.": "1 Samuel", "2 Sam.": "2 Samuel", "1 Kgs.": "1 Kings", "2 Kgs.": "2 Kings",
		"1 Chr.": "1 Chronicles", "2 Chr.": "2 Chronicles", "Ezra": "Ezra", "Neh.": "Nehemiah",
		"Esth.": "Esther", "Job": "Job", "Ps.": "Psalms", "Prov.": "Proverbs",
		"Eccl.": "Ecclesiastes", "Song": "Song of Solomon", "Isa.": "Isaiah", "Jer.": "Jeremiah",
		"Lam.": "Lamentations", "Ezek.": "Ezekiel", "Dan.": "Daniel", "Hosea": "Hosea",
		"Joel": "Joel", "Amos": "Amos", "Obad.": "Obadiah", "Jonah": "Jonah",
		"Micah": "Micah", "Nahum": "Nahum", "Hab.": "Habakkuk", "Zeph.": "Zephaniah",
		"Hag.": "Haggai", "Zech.": "Zechariah", "Mal.": "Malachi",
	},
	"nt.json": {
		"Matt.": "Matthew", "Mark": "Mark", "Luke": "Luke", "John": "John", "Acts": "Acts",
		"Rom.": "Romans", "1 Cor.": "1 Corinthians", "2 Cor.": "2 Corinthians",
		"Gal.": "Galatians", "Eph.": "Ephesians", "Philip.": "Philippians", "Col.": "Colossians",
		"1 Thes.": "1 Thessalonians", "2 Thes.": "2 Thessalonians",
		"1 Tim.": "1 Timothy", "2 Tim.": "2 Timothy", "Titus": "Titus", "Philem.": "Philemon",
		"Heb.": "Hebrews", "James": "James", "1 Pet.": "1 Peter", "2 Pet.": "2 Peter",
		"1 Jn.": "1 John", "2 Jn.": "2 John", "3 Jn.": "3 John", "Jude": "Jude", "Rev.": "Revelation",
	},
	"bom.json": {
		"1 Ne.": "1 Nephi", "2 Ne.": "2 Nephi", "Jacob": "Jacob", "Enos": "Enos",
		"Jarom": "Jarom", "Omni": "Omni", "W of M": "Words of Mormon", "Mosiah": "Mosiah",
		"Alma": "Alma", "Hel.": "Helaman", "3 Ne.": "3 Nephi", "4 Ne.": "4 Nephi",
		"Morm.": "Mormon", "Ether": "Ether", "Moro.": "Moroni",
	},
	"dac.json": {
		"D&C": "D&C", "OD": "Official Declaration",
	},
	"pogp.json": {
		"Moses": "Moses", "Abr.": "Abraham", "JS—M": "Joseph Smith Matthew",
		"JS—H": "Joseph Smith History", "A of F": "Articles of Faith",
	}
};

// Derived lookup maps (preserves canonical scripture order for backlink sorting)
const abbreviations: Record<string, string> = {};
const BOOK_TO_FILE: Record<string, string> = {};
// Flat ordered list of all book full-names across all standard works
const ALL_BOOKS: string[] = [];
for (const [dataFile, books] of Object.entries(BOOKS_BY_FILE)) {
	for (const [abbr, fullName] of Object.entries(books)) {
		abbreviations[abbr] = fullName;
		BOOK_TO_FILE[fullName] = dataFile;
		ALL_BOOKS.push(fullName);
	}
}

const VIEW_TYPE_SCRIPTURE_CONTEXT = "scripture-context-view";
const VIEW_TYPE_TRANSLATION = "translation-view";

const LANGUAGES: Record<string, string> = {
	"eng": "English",
	"por": "Portugu\u00eas",
	"ita": "Italiano",
	"fra": "Fran\u00e7ais",
	"spa": "Espa\u00f1ol",
	"rus": "\u0420\u0443\u0441\u0441\u043a\u0438\u0439",
	"kor": "\ud55c\uad6d\uc5b4",
	"jpn": "\u65e5\u672c\u8a9e",
	"zho": "\u4e2d\u6587",
	"deu": "Deutsch"
};

function getTranslationFile(baseFile: string, lang: string): string {
	if (lang === "eng") return baseFile;
	return baseFile.replace(".json", `_${lang}.json`);
}

class ScriptureContextView extends ItemView {
	private plugin: StandardWorksPlugin;
	private contentEl: HTMLElement;
	private contentContainer: HTMLElement;
	private isUpdating: boolean = false;
	private currentFile: string | null = null;
	private currentBook: string | null = null;
	private currentChapter: string | null = null;
	private currentVerse: string | null = null;
	private updateOnFileChange: boolean = true;
	private chapterHeaderEl: HTMLElement;
	private updateDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private prevChapterBtn: HTMLButtonElement;
	private nextChapterBtn: HTMLButtonElement;
	private activeContextMenu: HTMLElement | null = null;
	private boundDismissMenu: ((e: Event) => void) | null = null;
	private commentaryContainer: HTMLElement;
	private commentaryInputEl: HTMLInputElement;
	private commentaryPrevBtn: HTMLButtonElement;
	private commentaryNextBtn: HTMLButtonElement;
	private currentCommentaryRef: string | null = null;
	private currentCommentaryRefOrder: number | null = null;
	private wasActive: boolean = false;

	constructor(leaf: WorkspaceLeaf, plugin: StandardWorksPlugin) {
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
		this.contentEl = container.createDiv({ cls: "scripture-context-wrapper" });
		
		// Create header with toggle
		const headerEl = this.contentEl.createDiv({ cls: "scripture-context-header" });
		
		headerEl.createEl("h4", { text: "Scripture Context" });
		
		const toggleContainer = headerEl.createDiv({ cls: "scripture-context-toggle" });
		
		// Create search bar container
		const searchContainer = this.contentEl.createDiv({ cls: "scripture-search-container" });
		
		const searchInput = searchContainer.createEl("input", {
			type: "text",
			attr: { placeholder: "Go to verse (e.g., John 3:16 or John 3)" }
		});
		
		searchInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				const reference = searchInput.value.trim();
				if (reference) {
					this.loadContextByReference(reference);
					searchInput.value = ""; // Clear the input after loading
				}
			}
		});
		
		toggleContainer.createEl("span", { text: "Update on file change" });
		
		const toggleInput = toggleContainer.createEl("input", {
			attr: { type: "checkbox", checked: this.updateOnFileChange }
		});
		
		toggleInput.addEventListener("change", () => {
			this.updateOnFileChange = toggleInput.checked;
		});
		
		// Create chapter navigation bar
		const navContainer = this.contentEl.createDiv({ cls: "chapter-nav-container" });
		this.prevChapterBtn = navContainer.createEl("button", { text: "← Prev" });
		this.chapterHeaderEl = navContainer.createEl("span", { cls: "chapter-nav-label", text: "—" });
		this.nextChapterBtn = navContainer.createEl("button", { text: "Next →" });
		
		this.prevChapterBtn.disabled = true;
		this.nextChapterBtn.disabled = true;
		
		this.prevChapterBtn.addEventListener("click", () => this.navigateChapter(-1));
		this.nextChapterBtn.addEventListener("click", () => this.navigateChapter(1));

		// Split container holds both scripture and commentary halves
		const splitContainer = this.contentEl.createDiv({ cls: "scripture-split-container" });

		// Create content container (top half)
		this.contentContainer = splitContainer.createDiv({ cls: "scripture-context-content" });

		// Commentary panel (bottom half)
		const commentaryPanel = splitContainer.createDiv({ cls: "commentary-panel" });

		const commentaryHeaderEl = commentaryPanel.createDiv({ cls: "commentary-header" });
		commentaryHeaderEl.createEl("span", { cls: "commentary-title", text: "Commentary" });

		const commentarySearchContainer = commentaryHeaderEl.createDiv({ cls: "commentary-search-container" });
		this.commentaryInputEl = commentarySearchContainer.createEl("input", {
			type: "text",
			attr: { placeholder: "Reference (e.g., John 3:16)" }
		});
		const commentarySearchBtn = commentarySearchContainer.createEl("button", { text: "Go" });

		const commentaryNavEl = commentaryHeaderEl.createDiv({ cls: "commentary-nav" });
		this.commentaryPrevBtn = commentaryNavEl.createEl("button", { text: "← Prev" });
		this.commentaryNextBtn = commentaryNavEl.createEl("button", { text: "Next →" });
		this.commentaryPrevBtn.disabled = true;
		this.commentaryNextBtn.disabled = true;

		this.commentaryContainer = commentaryPanel.createDiv({ cls: "commentary-content" });

		this.commentaryInputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") this.loadCommentaryByReference(this.commentaryInputEl.value.trim());
		});
		commentarySearchBtn.addEventListener("click", () => this.loadCommentaryByReference(this.commentaryInputEl.value.trim()));
		this.commentaryPrevBtn.addEventListener("click", () => this.navigateCommentary(-1));
		this.commentaryNextBtn.addEventListener("click", () => this.navigateCommentary(1));

		// Register event to update when active file changes
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				// Check if this view's leaf just became active
				const isNowActive = leaf === this.leaf;
				
				if (isNowActive && !this.wasActive) {
					// View just became active - scroll to current verse if we have one
					if (this.currentVerse) {
						setTimeout(() => {
							this.scrollToActiveVerse();
						}, 100);
					}
				}
				
				this.wasActive = isNowActive;
				this.updateContext();
			})
		);
		
		// Defer initial update to ensure construction is fully complete
		setTimeout(() => this.updateContext(), 0);
	}

	async loadContextByReference(reference: string): Promise<void> {
		if (!this.contentContainer || this.isUpdating) return;
		
		// Parse the reference
		let book = "";
		let chapter = "";
		let verse = "1"; // Default to verse 1 if not specified
		
		if (reference.includes(":")) {
			// Format: "Book Chapter:Verse"
			const parts = reference.split(" ");
			const lastPart = parts[parts.length - 1];
			const chapterVerse = lastPart.split(":");
			
			book = parts.slice(0, -1).join(" ");
			chapter = chapterVerse[0];
			verse = chapterVerse[1];
		} else {
			// Format: "Book Chapter" - just show the chapter with verse 1 highlighted
			const parts = reference.split(" ");
			if (parts.length < 2) {
				new Notice("Invalid format. Use 'Book Chapter:Verse' or 'Book Chapter' (e.g., 'John 3:16' or 'John 3')");
				return;
			}
			chapter = parts[parts.length - 1];
			book = parts.slice(0, -1).join(" ");
		}
		
		// Expand abbreviations (exact match)
		book = abbreviations[book] || book;
		
		this.isUpdating = true;
		this.currentBook = book;
		this.currentChapter = chapter;
		this.currentVerse = verse;
		this.currentFile = null; // Not loading from a file
		
		try {
			await this.renderChapter(book, chapter, verse, true);
		} finally {
			this.isUpdating = false;
		}
	}

	async loadContextForFile(file: TFile): Promise<void> {
		if (!this.contentContainer || this.isUpdating) return;
		
		// Parse the filename to extract book, chapter, and verse
		const filename = file.basename;
		const match = filename.match(/^(.+?)\s+(\d+)\.(\d+)$/);
		
		if (!match) return;
		
		const bookName = match[1];
		const chapter = match[2];
		const verse = match[3];
		
		this.isUpdating = true;
		this.currentBook = bookName;
		this.currentChapter = chapter;
		this.currentVerse = verse;
		this.currentFile = file.path;
		
		try {
			await this.renderChapter(bookName, chapter, verse, false);
		} finally {
			this.isUpdating = false;
		}
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
			await this.renderChapter(bookName, chapter, verse, false);
		} finally {
			this.isUpdating = false;
		}
	}

	/**
	 * Shared method to load and render a chapter's verses into the content container.
	 * @param bookName - The full book name (e.g., "1 Nephi")
	 * @param chapter - The chapter number as a string
	 * @param verse - The verse to highlight
	 * @param showNotices - Whether to show Notice popups on errors (used for manual navigation)
	 */
	private async renderChapter(bookName: string, chapter: string, verse: string, showNotices: boolean): Promise<void> {
		this.contentContainer.empty();

		const dataFile = this.getDataFileForBook(bookName);
		if (!dataFile) {
			this.contentContainer.createEl("p", { text: `Unknown book: ${bookName}` });
			if (showNotices) new Notice(`Unknown book: ${bookName}`);
			return;
		}

		try {
			const scriptureData = await this.plugin.getScriptureData(dataFile);

			if (!scriptureData[bookName] || !scriptureData[bookName][chapter]) {
				this.contentContainer.createEl("p", { text: `Chapter ${chapter} not found in ${bookName}` });
				if (showNotices) new Notice(`Chapter ${chapter} not found in ${bookName}`);
				return;
			}

			const chapterData = scriptureData[bookName][chapter] as { [key: string]: string };

			this.chapterHeaderEl.setText(`${bookName} ${chapter}`);
			this.updateNavButtons(scriptureData, bookName, chapter);

			// Book-level heading (only on chapter 1)
			const bookHeading = scriptureData[bookName].heading;
			if (bookHeading && typeof bookHeading === "string" && chapter === "1") {
				const headingEl = this.contentContainer.createDiv({ cls: "chapter-heading" });
				headingEl.createEl("em", { text: bookHeading });
			}

			// Chapter-level heading (e.g., Mosiah 9, Alma 5, etc.)
			const chapterHeading = chapterData.heading;
			if (chapterHeading && typeof chapterHeading === "string") {
				const headingEl = this.contentContainer.createDiv({ cls: "chapter-heading" });
				headingEl.createEl("em", { text: chapterHeading });
			}

			const versesContainer = this.contentContainer.createDiv({ cls: "chapter-verses" });

			const verseNumbers = Object.keys(chapterData).filter(k => k !== "heading").sort((a, b) => parseInt(a) - parseInt(b));
			let activeVerseEl: HTMLElement | null = null;
			
			for (const verseNum of verseNumbers) {
				const isActive = verseNum === verse;
				const verseEl = versesContainer.createDiv({ cls: verseNum === verse ? "verse-item active" : "verse-item" });

				if (verseNum === verse) {
					activeVerseEl = verseEl;
				}

				verseEl.createEl("strong", { text: `${verseNum}. ` });
				verseEl.createSpan({ text: chapterData[verseNum] });

				// Click verse to open its note
				verseEl.addEventListener("click", () => {
					this.openVerseNote(bookName, chapter, verseNum);
				});

				// Right-click for context menu
				verseEl.addEventListener("contextmenu", (e) => {
					e.preventDefault();
					this.showVerseContextMenu(e, bookName, chapter, verseNum, chapterData[verseNum]);
				});
			}
			
			// Load commentary for the highlighted verse first
			await this.loadCommentaryForVerse(bookName, chapter, verse);
			
			// Scroll to active verse after everything is loaded and rendered
			if (activeVerseEl) {
				const scrollContainer = this.contentContainer;
				setTimeout(() => {
					requestAnimationFrame(() => {
						if (!activeVerseEl || !scrollContainer) return;
						
						const containerRect = scrollContainer.getBoundingClientRect();
						const targetRect = activeVerseEl.getBoundingClientRect();
						const relativeTop = targetRect.top - containerRect.top;
						const scrollTarget = scrollContainer.scrollTop + relativeTop - (containerRect.height / 2) + (targetRect.height / 2);
						
						scrollContainer.scrollTo({
							top: scrollTarget,
							behavior: "smooth"
						});
					});
				}, 150);
			}
		} catch (error) {
			console.error("Error loading scripture context:", error);
			this.contentContainer.createEl("p", { text: `Error loading context: ${error.message}` });
			if (showNotices) new Notice(`Error loading scripture: ${error.message}`);
		}
	}

	private getDataFileForBook(bookName: string): string | null {
		return BOOK_TO_FILE[bookName] || null;
	}

	private async loadCommentaryForVerse(bookName: string, chapter: string, verse: string): Promise<void> {
		const reference = `${bookName} ${chapter}:${verse}`;
		this.commentaryInputEl.value = reference;
		await this.loadCommentaryByReference(reference);
	}

	private async loadCommentaryByReference(reference: string): Promise<void> {
		if (!reference || !this.commentaryContainer) return;
		if (!this.plugin.db) {
			this.renderCommentaryContent(null, null);
			return;
		}
		try {
			const stmt = this.plugin.db.prepare("SELECT content, ref_order FROM ldss WHERE reference = :ref");
			stmt.bind({ ":ref": reference });
			if (stmt.step()) {
				const row = stmt.get();
				const content = row[0] as string;
				const refOrder = row[1] as number;
				stmt.free();
				this.currentCommentaryRef = reference;
				this.currentCommentaryRefOrder = refOrder;
				this.renderCommentaryContent(reference, content);
				this.updateCommentaryNavButtons();
			} else {
				stmt.free();
				this.currentCommentaryRef = null;
				this.currentCommentaryRefOrder = null;
				this.renderCommentaryContent(reference, null);
				this.updateCommentaryNavButtons();
			}
		} catch (err) {
			console.error("Commentary load error:", err);
			this.renderCommentaryContent(null, null);
		}
	}

	private renderCommentaryContent(reference: string | null, content: string | null): void {
		this.commentaryContainer.empty();
		if (content === null) {
			const msg = reference ? `No commentary for ${reference}` : "No commentary available";
			this.commentaryContainer.createEl("p", {
				text: msg,
				attr: { style: "color: var(--text-muted); padding: 8px;" }
			});
			return;
		}
		const pre = this.commentaryContainer.createEl("pre", { text: content });
		pre.style.whiteSpace = "pre-wrap";
		pre.style.wordBreak = "break-word";
		pre.style.margin = "0";
		pre.style.padding = "8px";
		pre.style.fontFamily = "serif";
		pre.style.userSelect = "text";
		pre.style.cursor = "text";
	}

	private async navigateCommentary(direction: number): Promise<void> {
		if (this.currentCommentaryRefOrder === null || !this.plugin.db) return;
		const newOrder = this.currentCommentaryRefOrder + direction;
		try {
			const stmt = this.plugin.db.prepare("SELECT reference, content, ref_order FROM ldss WHERE ref_order = :order");
			stmt.bind({ ":order": newOrder });
			if (stmt.step()) {
				const row = stmt.get();
				const ref = row[0] as string;
				const content = row[1] as string;
				const refOrder = row[2] as number;
				stmt.free();
				this.currentCommentaryRef = ref;
				this.currentCommentaryRefOrder = refOrder;
				this.commentaryInputEl.value = ref;
				this.renderCommentaryContent(ref, content);
				this.updateCommentaryNavButtons();
			} else {
				stmt.free();
			}
		} catch (err) {
			console.error("Commentary navigation error:", err);
		}
	}

	private updateCommentaryNavButtons(): void {
		if (this.currentCommentaryRefOrder === null || !this.plugin.db) {
			this.commentaryPrevBtn.disabled = true;
			this.commentaryNextBtn.disabled = true;
			return;
		}
		try {
			const prevStmt = this.plugin.db.prepare("SELECT 1 FROM ldss WHERE ref_order = :order");
			prevStmt.bind({ ":order": this.currentCommentaryRefOrder - 1 });
			this.commentaryPrevBtn.disabled = !prevStmt.step();
			prevStmt.free();
			const nextStmt = this.plugin.db.prepare("SELECT 1 FROM ldss WHERE ref_order = :order");
			nextStmt.bind({ ":order": this.currentCommentaryRefOrder + 1 });
			this.commentaryNextBtn.disabled = !nextStmt.step();
			nextStmt.free();
		} catch (err) {
			console.error("Error updating commentary nav buttons:", err);
		}
	}

	private updateHighlighting(newVerse: string): void {
		// Load commentary for the new verse
		if (this.currentBook && this.currentChapter) {
			this.loadCommentaryForVerse(this.currentBook, this.currentChapter, newVerse);
		}

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
				(verseEl as HTMLElement).classList.add("active");
				targetVerse = verseEl as HTMLElement;
			} else {
				(verseEl as HTMLElement).classList.remove("active");
			}
		});
		
		// Scroll to the target verse after updating all styles
		if (targetVerse) {
			// Scroll the actual scrollable container (contentContainer), not the inner versesContainer
			const scrollContainer = this.contentContainer;
			requestAnimationFrame(() => {
				if (!targetVerse || !scrollContainer) return;
				
				const containerRect = scrollContainer.getBoundingClientRect();
				const targetRect = targetVerse.getBoundingClientRect();
				const relativeTop = targetRect.top - containerRect.top;
				const scrollTarget = scrollContainer.scrollTop + relativeTop - (containerRect.height / 2) + (targetRect.height / 2);
				
				scrollContainer.scrollTo({
					top: scrollTarget,
					behavior: "smooth"
				});
			});
		}
	}

	private scrollToActiveVerse(): void {
		if (!this.currentVerse || !this.contentContainer) return;
		
		const versesContainer = this.contentContainer.querySelector(".chapter-verses") as HTMLElement;
		if (!versesContainer) return;
		
		const verseItems = versesContainer.querySelectorAll(".verse-item");
		let targetVerse: HTMLElement | null = null;
		
		verseItems.forEach((verseEl) => {
			const verseNumEl = verseEl.querySelector("strong");
			if (!verseNumEl) return;
			
			const verseNum = verseNumEl.textContent?.replace(".", "").trim();
			if (verseNum === this.currentVerse) {
				targetVerse = verseEl as HTMLElement;
			}
		});
		
		if (targetVerse) {
			const scrollContainer = this.contentContainer;
			requestAnimationFrame(() => {
				if (!targetVerse || !scrollContainer) return;
				
				const containerRect = scrollContainer.getBoundingClientRect();
				const targetRect = targetVerse.getBoundingClientRect();
				const relativeTop = targetRect.top - containerRect.top;
				const scrollTarget = scrollContainer.scrollTop + relativeTop - (containerRect.height / 2) + (targetRect.height / 2);
				
				scrollContainer.scrollTo({
					top: scrollTarget,
					behavior: "smooth"
				});
			});
		}
	}

	private openVerseNote(bookName: string, chapter: string, verse: string): void {
		const filename = `${bookName} ${chapter}.${verse}`;
		const files = this.app.vault.getFiles();
		const targetFile = files.find(f => f.basename === filename);
		
		if (targetFile) {
			this.app.workspace.getLeaf('tab').openFile(targetFile);
		} else {
			new Notice(`Note not found: ${filename}`);
		}
	}

	private showVerseContextMenu(e: MouseEvent, bookName: string, chapter: string, verse: string, text: string): void {
		this.dismissContextMenu();
		
		const menu = document.createElement("div");
		menu.addClass("verse-context-menu");
		menu.style.left = `${e.clientX}px`;
		menu.style.top = `${e.clientY}px`;
		
		const copyVerseItem = menu.createDiv({ cls: "verse-context-menu-item", text: "Copy verse text" });
		copyVerseItem.addEventListener("click", () => {
			navigator.clipboard.writeText(text);
			new Notice("Verse text copied");
			this.dismissContextMenu();
		});
		
		const copyRefItem = menu.createDiv({ cls: "verse-context-menu-item", text: "Copy reference" });
		copyRefItem.addEventListener("click", () => {
			navigator.clipboard.writeText(`${bookName} ${chapter}:${verse}`);
			new Notice("Reference copied");
			this.dismissContextMenu();
		});
		
		const copyWikilinkItem = menu.createDiv({ cls: "verse-context-menu-item", text: "Copy wikilink" });
		copyWikilinkItem.addEventListener("click", () => {
			const wikilink = `[[${bookName} ${chapter}.${verse}|${bookName} ${chapter}:${verse}]]`;
			navigator.clipboard.writeText(wikilink);
			new Notice("Wikilink copied");
			this.dismissContextMenu();
		});
		
		const copyBothItem = menu.createDiv({ cls: "verse-context-menu-item", text: "Copy reference + text" });
		copyBothItem.addEventListener("click", () => {
			navigator.clipboard.writeText(`${bookName} ${chapter}:${verse} — ${text}`);
			new Notice("Reference and text copied");
			this.dismissContextMenu();
		});
		
		const searchCommentaryItem = menu.createDiv({ cls: "verse-context-menu-item", text: "Search commentary" });
		searchCommentaryItem.addEventListener("click", () => {
			const reference = `${bookName} ${chapter}:${verse}`;
			new ReferenceSearchModal(this.app, this.plugin, reference).open();
			this.dismissContextMenu();
		});
		
		const openNoteItem = menu.createDiv({ cls: "verse-context-menu-item", text: "Open note" });
		openNoteItem.addEventListener("click", () => {
			this.openVerseNote(bookName, chapter, verse);
			this.dismissContextMenu();
		});
		
		document.body.appendChild(menu);
		this.activeContextMenu = menu;
		
		// Dismiss on click outside or scroll
		this.boundDismissMenu = () => this.dismissContextMenu();
		setTimeout(() => {
			document.addEventListener("click", this.boundDismissMenu!);
			document.addEventListener("contextmenu", this.boundDismissMenu!);
			this.contentContainer?.addEventListener("scroll", this.boundDismissMenu!);
		}, 0);
	}

	private dismissContextMenu(): void {
		if (this.activeContextMenu) {
			this.activeContextMenu.remove();
			this.activeContextMenu = null;
		}
		if (this.boundDismissMenu) {
			document.removeEventListener("click", this.boundDismissMenu);
			document.removeEventListener("contextmenu", this.boundDismissMenu);
			this.contentContainer?.removeEventListener("scroll", this.boundDismissMenu);
			this.boundDismissMenu = null;
		}
	}

	private updateNavButtons(scriptureData: ScriptureData, bookName: string, chapter: string): void {
		if (!scriptureData?.[bookName] || !this.prevChapterBtn || !this.nextChapterBtn) return;
		const chapters = Object.keys(scriptureData[bookName])
			.filter(k => k !== "heading")
			.map(Number)
			.sort((a, b) => a - b);
		const chapterNum = parseInt(chapter);
		const bookIdx = ALL_BOOKS.indexOf(bookName);
		
		// Disable prev only at the very first chapter of the very first book (Genesis 1)
		this.prevChapterBtn.disabled = chapterNum <= chapters[0] && bookIdx <= 0;
		// Disable next only at the very last chapter of the very last book (Articles of Faith)
		this.nextChapterBtn.disabled = chapterNum >= chapters[chapters.length - 1] && bookIdx >= ALL_BOOKS.length - 1;
	}

	private async navigateChapter(direction: number): Promise<void> {
		if (!this.currentBook || !this.currentChapter) return;
		
		const dataFile = this.getDataFileForBook(this.currentBook);
		if (!dataFile) return;
		
		const scriptureData = await this.plugin.getScriptureData(dataFile);
		const chapters = Object.keys(scriptureData[this.currentBook])
			.filter(k => k !== "heading")
			.map(Number)
			.sort((a, b) => a - b);
		
		const currentIdx = chapters.indexOf(parseInt(this.currentChapter));
		const newIdx = currentIdx + direction;
		
		if (newIdx >= 0 && newIdx < chapters.length) {
			// Navigate within the same book
			const newChapter = String(chapters[newIdx]);
			this.currentChapter = newChapter;
			this.currentVerse = "1";
			this.currentFile = null;
			await this.renderChapter(this.currentBook, newChapter, "1", false);
		} else {
			// Cross book boundary
			const bookIdx = ALL_BOOKS.indexOf(this.currentBook);
			const newBookIdx = bookIdx + direction;
			if (newBookIdx < 0 || newBookIdx >= ALL_BOOKS.length) return;
			
			const newBook = ALL_BOOKS[newBookIdx];
			const newDataFile = this.getDataFileForBook(newBook);
			if (!newDataFile) return;
			
			const newScriptureData = await this.plugin.getScriptureData(newDataFile);
			if (!newScriptureData[newBook]) return;
			
			const newChapters = Object.keys(newScriptureData[newBook])
				.filter(k => k !== "heading")
				.map(Number)
				.sort((a, b) => a - b);
			
			// Going forward: first chapter; going backward: last chapter
			const targetChapter = direction > 0 ? String(newChapters[0]) : String(newChapters[newChapters.length - 1]);
			
			this.currentBook = newBook;
			this.currentChapter = targetChapter;
			this.currentVerse = "1";
			this.currentFile = null;
			await this.renderChapter(newBook, targetChapter, "1", false);
		}
	}

	async onClose(): Promise<void> {
		this.dismissContextMenu();
		if (this.updateDebounceTimer) clearTimeout(this.updateDebounceTimer);
	}
}

class TranslationView extends ItemView {
	private plugin: StandardWorksPlugin;
	private contentContainer: HTMLElement;
	private refLabel: HTMLElement;
	private langPickerEl: HTMLElement;
	private langPickerVisible: boolean = false;
	private currentBook: string | null = null;
	private currentChapter: string | null = null;
	private currentVerse: string | null = null;
	private currentFile: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: StandardWorksPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_TRANSLATION; }
	getDisplayText(): string { return "Scripture Translations"; }
	getIcon(): string { return "languages"; }

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		const wrapper = container.createDiv({ cls: "translation-wrapper" });

		// Header row
		const headerEl = wrapper.createDiv({ cls: "translation-header" });
		headerEl.createEl("h4", { text: "Translations" });
		const toggleBtn = headerEl.createEl("button", { cls: "translation-lang-toggle", text: "\u2699 Languages" });

		// Language picker (collapsible)
		this.langPickerEl = wrapper.createDiv({ cls: "translation-lang-picker hidden" });
		this.buildLangPicker();

		toggleBtn.addEventListener("click", () => {
			this.langPickerVisible = !this.langPickerVisible;
			if (this.langPickerVisible) {
				this.langPickerEl.removeClass("hidden");
			} else {
				this.langPickerEl.addClass("hidden");
			}
		});

		// Current reference label
		this.refLabel = wrapper.createDiv({ cls: "translation-ref-label", text: "\u2014" });

		// Content area
		this.contentContainer = wrapper.createDiv({ cls: "translation-content" });

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.updateFromActiveFile();
			})
		);

		setTimeout(() => this.updateFromActiveFile(), 0);
	}

	private buildLangPicker(): void {
		this.langPickerEl.empty();
		for (const [code, name] of Object.entries(LANGUAGES)) {
			const label = this.langPickerEl.createEl("label", { cls: "translation-lang-item" });
			const cb = label.createEl("input", { attr: { type: "checkbox" } });
			cb.checked = this.plugin.settings.translationLanguages.includes(code);
			label.createSpan({ text: name });

			cb.addEventListener("change", async () => {
				if (cb.checked) {
					if (!this.plugin.settings.translationLanguages.includes(code)) {
						this.plugin.settings.translationLanguages.push(code);
					}
				} else {
					this.plugin.settings.translationLanguages = this.plugin.settings.translationLanguages.filter(l => l !== code);
				}
				await this.plugin.saveSettings();
				await this.renderTranslations();
			});
		}
	}

	refreshLangPicker(): void {
		this.buildLangPicker();
	}

	async updateFromActiveFile(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		const filePath = activeFile.path;
		if (filePath === this.currentFile) return;
		this.currentFile = filePath;

		const match = activeFile.basename.match(/^(.+?)\s+(\d+)\.(\d+)$/);
		if (!match) return;

		this.currentBook = match[1];
		this.currentChapter = match[2];
		this.currentVerse = match[3];
		await this.renderTranslations();
	}

	async renderTranslations(): Promise<void> {
		if (!this.contentContainer || !this.currentBook || !this.currentChapter || !this.currentVerse) return;

		this.contentContainer.empty();

		const langs = this.plugin.settings.translationLanguages;
		if (langs.length === 0) {
			this.contentContainer.createEl("p", {
				text: "No languages selected. Click \u2699 Languages to choose translations.",
				attr: { style: "color: var(--text-muted); padding: 10px;" }
			});
			return;
		}

		this.refLabel.setText(`${this.currentBook} ${this.currentChapter}:${this.currentVerse}`);

		const baseFile = BOOK_TO_FILE[this.currentBook];
		if (!baseFile) {
			this.contentContainer.createEl("p", { text: `Unknown book: ${this.currentBook}` });
			return;
		}

		for (const lang of langs) {
			const langBlock = this.contentContainer.createDiv({ cls: "translation-lang-block" });
			const langHeader = langBlock.createDiv({ cls: "translation-lang-header" });
			langHeader.createEl("span", { text: LANGUAGES[lang] || lang });
			const verseEl = langBlock.createDiv({ cls: "translation-verse-text", text: "Loading\u2026" });

			const translationFile = getTranslationFile(baseFile, lang);
			try {
				await this.plugin.ensureTranslationFile(translationFile);
				const data = await this.plugin.getScriptureData(translationFile);
				const chData = data[this.currentBook]?.[this.currentChapter] as { [key: string]: string } | undefined;
				const verseText = chData?.[this.currentVerse];
				if (verseText) {
					verseEl.setText(verseText);
				} else {
					verseEl.setText("\u2014");
					verseEl.style.color = "var(--text-muted)";
				}
			} catch (err) {
				verseEl.setText(`Failed to load: ${err.message}`);
				verseEl.style.color = "var(--text-error)";
			}
		}
	}

	async onClose(): Promise<void> { }
}

export default class StandardWorksPlugin extends Plugin {
	settings: StandardWorksPluginSettings;
	SQL: SqlJsStatic | null = null;
	db: Database | null = null;
	private observer: MutationObserver;
	private scriptureDataCache = new Map<string, ScriptureData>();
	
	// Store last search state
	lastSearchTerm: string = "";
	lastSearchResults: SearchResult[] = [];
	lastSearchPage: number = 0;
	lastSearchIsRegex: boolean = false;
	lastScrollPosition: number = 0;
	lastSelectedWorks: { ot: boolean; nt: boolean; bom: boolean; dac: boolean; pogp: boolean } = {
		ot: true,
		nt: true,
		bom: true,
		dac: true,
		pogp: true
	};

	async onload() {
		await this.loadSettings();
		await this.loadSqlJs();
		await this.ensureDataDirectory();
		await this.loadDatabase();
		console.log("Loading LDSS Plugin");

		// Register the custom view
		this.registerView(
			VIEW_TYPE_SCRIPTURE_CONTEXT,
			(leaf) => new ScriptureContextView(leaf, this)
		);

		// Register translation view
		this.registerView(
			VIEW_TYPE_TRANSLATION,
			(leaf) => new TranslationView(leaf, this)
		);

		// Add command to open the custom view
		this.addCommand({
			id: "open-scripture-context-view",
			name: "Open Scripture Context View",
			callback: () => {
				this.activateView();
			}
		});

		// Add command to open the translation view
		this.addCommand({
			id: "open-translation-view",
			name: "Open Scripture Translations View",
			callback: () => {
				this.activateTranslationView();
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

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: TFile) => {
				// Check if file matches verse pattern: "Book Name Chapter.Verse"
				const filename = file.basename;
				const match = filename.match(/^(.+?)\s+(\d+)\.(\d+)$/);
				
				if (match) {
					menu.addItem((item) =>
						item
							.setTitle("Open Context")
							.setIcon("book-open")
							.onClick(async () => {
								// Activate the Scripture Context view
								await this.activateView();
								// Load the context for this file without navigating to it
								const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SCRIPTURE_CONTEXT);
								if (leaves.length > 0) {
									const view = leaves[0].view as ScriptureContextView;
									await view.loadContextForFile(file);
								}
							})
					);
				}
			})
		);

		this.addCommand({
			id: "linkify-selected-text",
			name: "Linkify scripture references",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.linkifySelectedText(editor);
			},
		});

		this.addCommand({
			id: "go-to-verse",
			name: "Go to verse",
			callback: () => {
				new ScriptureReferenceSuggestModal(this.app, this, (reference: string) => {
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
				let defaultReference = activeFile ? activeFile.basename : "";

				// Split the filename after the hyphen
				defaultReference = defaultReference.replace(".", ":") // Replace ":" with "."
				// Remove any leading or trailing whitespace
				
				new ReferenceSearchModal(this.app, this, defaultReference).open();
			}
		});

		this.addCommand({
			id: "search-scripture-text",
			name: "Search Scripture Text",
			callback: () => {
				new ScriptureSearchModal(this.app, this).open();
			}
		});

		this.addSettingTab(new StandardWorksPluginSettingTab(this.app, this));
		
		// Open Scripture Context View by default
		this.activateView();
	}

	private async displayResults(tries: number = 0) {
		// Get current active file name as default reference
		const activeFile = this.app.workspace.getActiveFile();
		let defaultReference = activeFile ? activeFile.basename : "";

		defaultReference = defaultReference.replace(".", ":") // Replace ":" with "."
		// Remove any leading or trailing whitespace
		try{
			const stmt = this.db.prepare("SELECT content FROM ldss WHERE reference = :ref");
			stmt.bind({ ":ref": defaultReference });
			
			if (stmt.step()) {
				const row = stmt.get();
				const content = row[0] as string;
				stmt.free();
				new ResultsModal(this.app, `Reference: ${defaultReference}\n\n${content}`).open();
			} else {
				stmt.free();
				new ResultsModal(this.app, `No results found for reference: ${defaultReference}`).open();
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
			const items = Array.from(
				container.querySelectorAll("div.tree-item.search-result")
			);
			
			if (items.length < 2) return;
			const gcItems: Element[] = [];
			const tgItems: Element[] = [];
			const verses: Element[] = [];

			for (const item of items) {
				const textContent = item.querySelector("div.search-result-file-title")?.textContent || "";
				if(textContent.includes("April") || textContent.includes("October")) {
					gcItems.push(item)
				}
				else if (textContent.includes(".")) {
					verses.push(item)
				}
				else {
					tgItems.push(item)
				}
			}

			gcItems.sort((a, b) => {
				const atextContent = a.querySelector("div.search-result-file-title")?.textContent || "";
				const btextContent = b.querySelector("div.search-result-file-title")?.textContent || "";
				return btextContent.localeCompare(atextContent);
			});

			tgItems.sort((a, b) => {
				const atextContent = a.querySelector("div.search-result-file-title")?.textContent || "";
				const btextContent = b.querySelector("div.search-result-file-title")?.textContent || "";
				return atextContent.localeCompare(btextContent);
			});


			// Sort by text content
			verses.sort((a, b) => {

				let aBookInt = -1;
				let bBookInt = -1;
				const atextContent = a.querySelector("div.search-result-file-title")?.textContent || "";
				const btextContent = b.querySelector("div.search-result-file-title")?.textContent || "";
				const aBookStr = atextContent.split(' ').slice(0, -1).join(' ') || "";
				const bBookStr = btextContent.split(' ').slice(0, -1).join(' ') || "";
				const aChapter = parseInt(a.textContent?.split(' ').slice(-1)[0].split(':')[0] || "");
				const bChapter = parseInt(b.textContent?.split(' ').slice(-1)[0].split(':')[0] || "");
				const aVerse = parseInt(a.textContent?.split(' ').slice(-1)[0].split(':')[1] || "");
				const bVerse = parseInt(b.textContent?.split(' ').slice(-1)[0].split(':')[1] || "");
				let i = 0;
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
			for (const item of tgItems) {
				container.appendChild(item);
			}
			// Add GC items
			for (const item of gcItems) {
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

	async activateTranslationView() {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_TRANSLATION)[0];

		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf.setViewState({
				type: VIEW_TYPE_TRANSLATION,
				active: true,
			});
		}

		workspace.revealLeaf(leaf);
	}

	async ensureTranslationFile(translationFile: string): Promise<void> {
		// English uses the base files which already exist
		if (!translationFile.includes("_")) return;
		// Already cached — no need to hit disk
		if (this.scriptureDataCache.has(translationFile)) return;

		const adapter = this.app.vault.adapter;
		const basePath = (this.manifest as any).dir;
		const filePath = `${basePath}/data/${translationFile}`;

		let exists = false;
		try {
			const stat = await adapter.stat(filePath);
			exists = stat !== null;
		} catch {
			exists = false;
		}

		if (!exists) {
			const url = `https://raw.githubusercontent.com/GabeScott/standard-works-plugin/main/data/${translationFile}`;
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} fetching ${translationFile}`);
			}
			const arrayBuffer = await response.arrayBuffer();
			await adapter.writeBinary(filePath, arrayBuffer);
		}
	}

	refreshTranslationView(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TRANSLATION);
		for (const leaf of leaves) {
			const view = leaf.view as TranslationView;
			view.refreshLangPicker();
			view.renderTranslations();
		}
	}

	onunload() {
		this.db?.close();
		this.db = null;
		this.observer.disconnect();
		this.scriptureDataCache.clear();

		// Clean up the custom views
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_SCRIPTURE_CONTEXT);
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_TRANSLATION);
	}

	async loadSqlJs() {
		this.SQL = await initSqlJs({
			locateFile: file => `https://sql.js.org/dist/sql-wasm.wasm`,
		});
	}

	async ensureDataDirectory() {
		console.log("Ensuring data directory and files exist...");
		const adapter = this.app.vault.adapter;
		const basePath = (this.manifest as any).dir;
		const dataPath = `${basePath}/data`;
		console.log(`Plugin directory: ${basePath}`);
		console.log(`Data directory path: ${dataPath}`);
		try {
			const pluginContents = await adapter.list(basePath);
			console.log("Plugin directory contents:", pluginContents);
		} catch (err) {
			console.error("Failed to list plugin directory:", err);
		}
		const files = [
			"bom.json",
			"commentary.db",
			"dac.json",
			"nt.json",
			"ot.json",
			"pogp.json"
		];
		let dataDirExists = false;
		try {
			const statResult = await adapter.stat(dataPath);
			console.log("Data directory stat result:", statResult);
			dataDirExists = statResult !== null && statResult.type === "folder";
			console.log(`Data directory exists: ${dataDirExists}`);
		} catch (err) {
			console.log("Data directory not found (stat failed):", err);
			dataDirExists = false;
		}
		if (!dataDirExists) {
			console.log("Creating data directory...");
			try {
				await adapter.mkdir(dataPath);
				console.log("Data directory created successfully");
			} catch (mkdirErr) {
				console.error("Failed to create data directory:", mkdirErr);
			}
		}
		const missingFiles: string[] = [];
		for (const file of files) {
			const filePath = `${dataPath}/${file}`;
			try {
				const fileStatResult = await adapter.stat(filePath);
				if (fileStatResult === null) {
					console.log(`File ${file} does not exist (stat returned null)`);
					missingFiles.push(file);
				}
			} catch (err) {
				console.log(`File ${file} does not exist (stat threw error):`, err);
				missingFiles.push(file);
			}
		}
		console.log(`Total missing files: ${missingFiles.length}`, missingFiles);
		if (missingFiles.length > 0) {
			console.log(`Missing ${missingFiles.length} data files, downloading...`);
			new Notice(`Downloading ${missingFiles.length} scripture data files...`);
			const githubRawUrl = "https://raw.githubusercontent.com/GabeScott/standard-works-plugin/main/data";
			let downloadedCount = 0;
			for (const file of missingFiles) {
				try {
					const url = `${githubRawUrl}/${file}`;
					console.log(`Downloading ${file} from ${url}`);
					const response = await fetch(url);
					if (!response.ok) {
						console.error(`Failed to download ${file}: ${response.statusText}`);
						new Notice(`Failed to download ${file}`);
						continue;
					}
					const arrayBuffer = await response.arrayBuffer();
					const filePath = `${dataPath}/${file}`;
					await adapter.writeBinary(filePath, arrayBuffer);
					console.log(`Downloaded ${file}`);
					downloadedCount++;
				} catch (downloadErr) {
					console.error(`Error downloading ${file}:`, downloadErr);
					new Notice(`Error downloading ${file}`);
				}
			}
			if (downloadedCount === missingFiles.length) {
				new Notice("All scripture data files downloaded successfully!");
			} else {
				new Notice(`Downloaded ${downloadedCount} of ${missingFiles.length} files. Check console for errors.`);
			}
		}
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

	async getScriptureData(dataFile: string): Promise<ScriptureData> {
		const cached = this.scriptureDataCache.get(dataFile);
		if (cached) return cached;

		const adapter = this.app.vault.adapter;
		const basePath = (this.manifest as any).dir;
		const fullPath = `${basePath}/data/${dataFile}`;
		const jsonContent = await adapter.read(fullPath);
		const data: ScriptureData = JSON.parse(jsonContent);
		this.scriptureDataCache.set(dataFile, data);
		return data;
	}

	getScriptureDataSync(dataFile: string): ScriptureData | null {
		return this.scriptureDataCache.get(dataFile) || null;
	}

	private fileExists(filename: string): boolean {
		const files = this.app.vault.getFiles();
		const target = filename + ".md";
		for (const file of files) {
			if (file.name === target) {
				return true;
			}
		}
		new Notice("File not found: " + target);
		return false;
	}

	private getNumVerses(book: string, chapter: string): string[] {
		const verses: string[] = [];
		let finalVerse = 0;
		const files = this.app.vault.getFiles();
		for (const file of files) {
			if (file.name.startsWith(`${book} ${chapter}.`)) {
				const verseStr = file.name.split(".")[1];
				const verseNum = parseInt(verseStr);
				if(verseNum > finalVerse){
					finalVerse = verseNum;
				}
			}
		}
		if(finalVerse === 0){
			new Notice(`Chapter not found: ${book} ${chapter}`);
			return [];
		}
		for (let i = 1; i <= finalVerse; i++) {
			verses.push(i.toString());
		}
		return verses;
	}

	// Return an array of [start, end) index pairs for every [[...]] wikilink span in text.
	// Used to skip matches that already fall inside an existing wikilink.
	private wikilinkRanges(text: string): Array<[number, number]> {
		const ranges: Array<[number, number]> = [];
		const wlRegex = /\[\[.*?\]\]/gs;
		let m: RegExpExecArray | null;
		while ((m = wlRegex.exec(text)) !== null) {
			ranges.push([m.index, m.index + m[0].length]);
		}
		return ranges;
	}

	// Return true if any character of [matchStart, matchStart+matchLen) falls inside a wikilink range.
	private isInsideWikilink(matchStart: number, matchLen: number, ranges: Array<[number, number]>): boolean {
		const matchEnd = matchStart + matchLen;
		for (const [rs, re] of ranges) {
			// Overlaps if match start < range end AND match end > range start
			if (matchStart < re && matchEnd > rs) return true;
		}
		return false;
	}

	// Build a wikilink string for a single scripture reference token (e.g. "John 3:16").
	// Returns the replacement string, or the original token if no matching file is found.
	private linkifySingleRef(refText: string): string {
		const trimmed = refText.trim();
		let result = trimmed;

		let book = trimmed.split(" ").slice(0, -1).join(" ");
		book = abbreviations[book] || book;

		let chapter = "";
		let verses: string[] = [];

		if (!trimmed.includes(":")) {
			chapter = trimmed.split(" ").slice(-1)[0];
			verses = this.getNumVerses(book, chapter);
		} else {
			chapter = trimmed.split(" ").slice(-1)[0].split(":")[0];
			verses = trimmed.split(" ").slice(-1)[0].split(":")[1].split(",").map((v: string) => v.trim());
		}

		let finishedFirst = false;

		for (const verse of verses) {
			if (verse.includes("-")) {
				const [start, end] = verse.split("-");
				for (let i = parseInt(start); i <= parseInt(end); i++) {
					const filename = `${book} ${chapter}.${i}`;
					const files = this.app.vault.getFiles();
					const target = filename + ".md";
					const exists = files.some(f => f.name === target);
					if (exists) {
						if (finishedFirst)
							result += `[[${filename}|]]`;
						else {
							result = `[[${filename}|${trimmed}]]`;
							finishedFirst = true;
						}
					}
				}
			} else {
				const filename = `${book} ${chapter}.${verse}`;
				const files = this.app.vault.getFiles();
				const target = filename + ".md";
				const exists = files.some(f => f.name === target);
				if (exists) {
					if (finishedFirst)
						result += `[[${filename}|]]`;
					else {
						result = `[[${filename}|${trimmed}]]`;
						finishedFirst = true;
					}
				}
			}
		}

		return result;
	}

	// Build a regex that matches any known scripture reference (book name or abbreviation
	// followed by chapter:verse or chapter:verse-range or chapter:v1,v2,...).
	private buildScriptureRefRegex(): RegExp {
		// Collect all recognised book tokens (full names + abbreviation keys), sorted
		// longest-first so multi-word names like "1 Nephi" match before bare "Nephi".
		const bookTokens: string[] = [];
		for (const [abbr, full] of Object.entries(abbreviations)) {
			bookTokens.push(full);
			if (abbr !== full) bookTokens.push(abbr);
		}
		// Deduplicate and sort longest-first
		const unique = [...new Set(bookTokens)];
		unique.sort((a, b) => b.length - a.length);

		// Escape each token for use in a regex
		const escaped = unique.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

		// Reference pattern: <book> <chapter>(:<verses>)?
		// verses = digit(s), optional range (-digit+) or comma-list
		const pattern = `(${escaped.join("|")})\\s+(\\d+(?::\\d+(?:[,\\-]\\d+)*)?)`;
		return new RegExp(pattern, "g");
	}

	// Extract the text region covering the last N sentences ending at the cursor.
	// Returns { text, from, to } using CodeMirror-style {line, ch} positions.
	private extractLastNSentences(editor: Editor, n: number): { text: string; from: { line: number; ch: number }; to: { line: number; ch: number } } | null {
		const cursor = editor.getCursor();
		// Collect text from the start of the document up to the cursor
		let allText = "";
		for (let ln = 0; ln < cursor.line; ln++) {
			allText += editor.getLine(ln) + "\n";
		}
		allText += editor.getLine(cursor.line).slice(0, cursor.ch);

		if (!allText.trim()) return null;

		// Walk backward finding sentence boundaries: [.!?] followed by whitespace or end.
		// We skip the trailing boundary of the cursor position itself and count N more.
		// Note: abbreviations ending in "." (e.g. "v.", "vs.", "1 Ne.") can produce
		// false sentence splits. We do not attempt to fix all cases — common LDS
		// scripture prose still works because the abbreviation period is usually
		// surrounded by word chars, not by two spaces.
		let boundariesFound = 0;
		let cutIndex = allText.length;

		for (let i = allText.length - 1; i >= 0; i--) {
			const ch = allText[i];
			if (ch === "." || ch === "!" || ch === "?") {
				// Check that something follows this terminator (space/newline) or it's the last char
				const next = allText[i + 1];
				if (next === undefined || next === " " || next === "\n" || next === "\r") {
					// Skip if this looks like a likely abbreviation: single capital letter before dot,
					// or known short sequences like "v." / "vs." at the period position.
					const before = allText.slice(Math.max(0, i - 3), i);
					if (/\b(v|vs|Dr|Mr|Mrs|St|Jr|Sr)$/.test(before)) continue;
					boundariesFound++;
					if (boundariesFound === n) {
						cutIndex = i + 1; // include the terminator character
						break;
					}
				}
			}
		}

		// cutIndex is where our N-sentence window starts
		const windowText = allText.slice(cutIndex);
		if (!windowText.trim()) return null;

		// Convert cutIndex (offset in allText) back to {line, ch}
		let remaining = cutIndex;
		let fromLine = 0;
		let fromCh = 0;
		for (let ln = 0; ln <= cursor.line; ln++) {
			const lineLen = ln < cursor.line
				? editor.getLine(ln).length + 1  // +1 for \n
				: cursor.ch;
			if (remaining <= lineLen) {
				fromLine = ln;
				fromCh = remaining;
				break;
			}
			remaining -= lineLen;
		}

		return {
			text: windowText,
			from: { line: fromLine, ch: fromCh },
			to: { line: cursor.line, ch: cursor.ch },
		};
	}

	private linkifySelectedText(editor: Editor) {
		const selection = editor.getSelection();

		if (selection.trim()) {
			// --- Selection-based path (original behavior) ---
			const selectedText = selection.trim();
			// If the selected text is already (or is contained within) a wikilink, skip it.
			const selRanges = this.wikilinkRanges(selectedText);
			if (selRanges.length > 0 && this.isInsideWikilink(0, selectedText.length, selRanges)) {
				new Notice("Selection is already a wikilink");
				return;
			}
			const result = this.linkifySingleRef(selectedText);
			if (result === selectedText) {
				new Notice("No matching scripture reference found in selection");
				return;
			}
			editor.replaceSelection(result);
			return;
		}

		// --- No-selection path: scan last N sentences from cursor ---
		const n = Math.max(1, Math.min(10, this.settings.linkifySentencesToScan ?? 1));
		const region = this.extractLastNSentences(editor, n);

		if (!region) {
			new Notice("No text found before cursor to linkify");
			return;
		}

		const regex = this.buildScriptureRefRegex();
		// Pre-compute all wikilink spans in the region so we can skip matches that
		// fall inside an existing [[...]] (e.g. the display text after the pipe).
		const wlRanges = this.wikilinkRanges(region.text);
		let anyReplaced = false;
		const replaced = region.text.replace(regex, (match: string, ...args: unknown[]) => {
			// args: capture groups..., offset, fullString
			const offset = args[args.length - 2] as number;
			// Skip if this match overlaps any existing wikilink span
			if (this.isInsideWikilink(offset, match.length, wlRanges)) return match;
			const linked = this.linkifySingleRef(match);
			if (linked !== match) anyReplaced = true;
			return linked;
		});

		if (!anyReplaced) {
			new Notice("No scripture references found in the last " + n + " sentence" + (n === 1 ? "" : "s"));
			return;
		}

		editor.replaceRange(replaced, region.from, region.to);
		// Place cursor at end of replaced text, accounting for possible newlines
		const replacedLines = replaced.split("\n");
		const endLine = region.from.line + replacedLines.length - 1;
		const endCh = replacedLines.length === 1
			? region.from.ch + replaced.length
			: replacedLines[replacedLines.length - 1].length;
		editor.setCursor(endLine, endCh);
	}

	private goToVerse(reference: string) {
		if (!reference || !reference.trim()) {
			new Notice("Please enter a verse reference");
			return;
		}

		const trimmedRef = reference.trim();
		let book = "";
		let chapter = "";
		let verse = "1";
		
		if (trimmedRef.includes(":")) {
			const parts = trimmedRef.split(" ");
			const lastPart = parts[parts.length - 1];
			const chapterVerse = lastPart.split(":");
			book = parts.slice(0, -1).join(" ");
			chapter = chapterVerse[0];
			verse = chapterVerse[1];
		} else {
			// Chapter-only: "John 3" → opens John 3.1
			const parts = trimmedRef.split(" ");
			if (parts.length < 2) {
				new Notice("Invalid format. Use 'Book Chapter' or 'Book Chapter:Verse'");
				return;
			}
			chapter = parts[parts.length - 1];
			book = parts.slice(0, -1).join(" ");
		}
		
		book = abbreviations[book] || book;
		
		const filename = `${book} ${chapter}.${verse}`;
		const files = this.app.vault.getFiles();
		const targetFile = files.find(f => f.basename === filename);
		
		if (!targetFile) {
			new Notice(`Verse not found: ${filename}`);
			return;
		}
		
		this.app.workspace.getLeaf('tab').openFile(targetFile);
	}
	
	async searchScriptures(searchTerm: string, dataFiles: string[], useRegex: boolean = false): Promise<SearchResult[]> {
		const results: SearchResult[] = [];
		
		// Build match function based on mode
		let matchFn: (text: string) => boolean;
		if (useRegex) {
			try {
				// User can input raw regex  - no wildcard conversion needed
				const regex = new RegExp(searchTerm, 'i');
				matchFn = (text: string) => regex.test(text);
			} catch (e) {
				new Notice(`Invalid regex pattern: ${e.message}`);
				return results;
			}
		} else {
			const searchLower = searchTerm.toLowerCase();
			matchFn = (text: string) => text.toLowerCase().includes(searchLower);
		}
		
		for (const dataFile of dataFiles) {
			try {
				const scriptureData = await this.getScriptureData(dataFile);
				
				for (const bookName in scriptureData) {
					const bookData = scriptureData[bookName];
					
					for (const chapterKey in bookData) {
						if (chapterKey === "heading") continue;
						
						const chapterData = bookData[chapterKey];
						
						if (typeof chapterData === "object" && chapterData !== null) {
							for (const verseKey in chapterData) {
								const verseText = chapterData[verseKey];
								
								if (matchFn(verseText)) {
									results.push({
										book: bookName,
										chapter: chapterKey,
										verse: verseKey,
										text: verseText
									});
								}
							}
						}
					}
				}
			} catch (error) {
				console.error(`Error loading scripture data from ${dataFile}:`, error);
				new Notice(`Error loading ${dataFile}`);
			}
		}
		
		return results;
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
		
		this.modalEl.addClass("results-modal");
		
		contentEl.createEl("h2", { text: "Query Results" });
		
		// Create controls div
		const controlsDiv = contentEl.createEl("div", { cls: "results-controls" });
		
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
		
		// Create pre element for the content
		const pre = resultsContainer.createEl("pre", { text: this.results });
		pre.style.overflowX = this.wordWrap ? "hidden" : "auto";
		pre.style.whiteSpace = this.wordWrap ? "pre-wrap" : "pre";
		pre.style.wordBreak = this.wordWrap ? "break-word" : "normal";
		
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
	plugin: StandardWorksPlugin;
	defaultReference: string;
	private currentReference: string = "";
	private currentRefOrder: number | null = null;
	private currentContent: string = "";
	private resultsContainer: HTMLElement;
	private inputEl: HTMLInputElement;
	private prevBtn: HTMLButtonElement;
	private nextBtn: HTMLButtonElement;
	private wordWrap: boolean = true;

	constructor(app: App, plugin: StandardWorksPlugin, defaultReference: string) {
		super(app);
		this.plugin = plugin;
		this.defaultReference = defaultReference;
	}

	onOpen() {
		const { contentEl } = this;
		
		// Make modal wider
		this.modalEl.addClass("scripture-search-modal");
		
		contentEl.createEl("h2", { text: "Search Scripture Commentary" });

		// Search input container
		const searchContainer = contentEl.createEl("div", { cls: "search-input-container" });
		
		this.inputEl = searchContainer.createEl("input", {
			type: "text",
			attr: { 
				placeholder: "e.g., John 3:16",
				value: this.defaultReference
			}
		});
		
		const searchBtn = searchContainer.createEl("button", { text: "Search" });
		
		// Navigation container
		const navContainer = contentEl.createEl("div", { cls: "pagination-container" });
		this.prevBtn = navContainer.createEl("button", { text: "Previous" });
		this.prevBtn.disabled = true;
		this.nextBtn = navContainer.createEl("button", { text: "Next" });
		this.nextBtn.disabled = true;
		
		this.prevBtn.addEventListener("click", () => this.navigate(-1));
		this.nextBtn.addEventListener("click", () => this.navigate(1));
		
		// Create controls div for word wrap
		const controlsDiv = contentEl.createEl("div", { cls: "results-controls" });
		const wrapToggleLabel = controlsDiv.createEl("label");
		const wrapToggle = wrapToggleLabel.createEl("input", {
			attr: { 
				type: "checkbox",
				checked: this.wordWrap
			}
		});
		wrapToggleLabel.append(" Word Wrap");
		
		// Results container
		this.resultsContainer = contentEl.createEl("div", { cls: "results-container" });
		this.resultsContainer.createEl("p", { 
			text: "Enter a scripture reference and click Search.",
			attr: { style: "color: var(--text-muted); text-align: center; margin-top: 20px;" }
		});
		
		// Auto-focus and select all text in input
		setTimeout(() => {
			this.inputEl.focus();
			this.inputEl.select();
		}, 0);
		
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				this.performSearch(this.inputEl.value);
			}
		});

		searchBtn.addEventListener("click", () => {
			this.performSearch(this.inputEl.value);
		});
		
		// Handle word wrap toggle
		wrapToggle.addEventListener("change", () => {
			this.wordWrap = wrapToggle.checked;
			const pre = this.resultsContainer.querySelector("pre");
			if (pre) {
				pre.style.whiteSpace = this.wordWrap ? "pre-wrap" : "pre";
				pre.style.wordBreak = this.wordWrap ? "break-word" : "normal";
				pre.style.overflowX = this.wordWrap ? "hidden" : "auto";
			}
		});
		
		// Auto-search if default reference is provided
		if (this.defaultReference && this.defaultReference.trim()) {
			this.performSearch(this.defaultReference);
		}
	}
	
	private async performSearch(reference: string) {
		if (!reference || !reference.trim()) {
			new Notice("Please enter a reference");
			return;
		}
		
		if (!this.plugin.db) {
			new Notice("Database not loaded.");
			return;
		}
		
		this.resultsContainer.empty();
		this.resultsContainer.createEl("p", { 
			text: "Searching...",
			attr: { style: "color: var(--text-muted); text-align: center; margin-top: 20px;" }
		});
		
		try {
			const stmt = this.plugin.db.prepare("SELECT content, ref_order FROM ldss WHERE reference = :ref");
			stmt.bind({ ":ref": reference.trim() });
			
			if (stmt.step()) {
				const row = stmt.get();
				const content = row[0] as string;
				const refOrder = row[1] as number;
				stmt.free();
				
				this.currentReference = reference.trim();
				this.currentRefOrder = refOrder;
				this.currentContent = content;
				
				this.displayResults();
				this.updateNavButtons();
			} else {
				stmt.free();
				this.resultsContainer.empty();
				this.resultsContainer.createEl("p", { 
					text: `No results found for reference: ${reference}`,
					attr: { style: "color: var(--text-muted); text-align: center; margin-top: 20px;" }
				});
				this.currentRefOrder = null;
				this.updateNavButtons();
			}
		} catch (err) {
			console.error("Scripture search error:", err);
			new Notice("Error searching for reference.");
			this.resultsContainer.empty();
			this.resultsContainer.createEl("p", { 
				text: `Error: ${err.message}`,
				attr: { style: "color: var(--text-error); text-align: center; margin-top: 20px;" }
			});
		}
	}
	
	private displayResults() {
		this.resultsContainer.empty();
		
		if (!this.currentContent) return;
		
		const pre = this.resultsContainer.createEl("pre", { text: `Reference: ${this.currentReference}\n\n${this.currentContent}` });
		pre.style.overflowX = this.wordWrap ? "hidden" : "auto";
		pre.style.whiteSpace = this.wordWrap ? "pre-wrap" : "pre";
		pre.style.wordBreak = this.wordWrap ? "break-word" : "normal";
	}
	
	private async navigate(direction: number) {
		if (this.currentRefOrder === null || !this.plugin.db) return;
		
		const newRefOrder = this.currentRefOrder + direction;
		
		try {
			const stmt = this.plugin.db.prepare("SELECT reference, content, ref_order FROM ldss WHERE ref_order = :order");
			stmt.bind({ ":order": newRefOrder });
			
			if (stmt.step()) {
				const row = stmt.get();
				const reference = row[0] as string;
				const content = row[1] as string;
				const refOrder = row[2] as number;
				stmt.free();
				
				this.currentReference = reference;
				this.currentRefOrder = refOrder;
				this.currentContent = content;
				this.inputEl.value = reference;
				
				this.displayResults();
				this.updateNavButtons();
			} else {
				stmt.free();
				// Reached the end/beginning
				this.updateNavButtons();
			}
		} catch (err) {
			console.error("Navigation error:", err);
			new Notice("Error navigating.");
		}
	}
	
	private updateNavButtons() {
		if (this.currentRefOrder === null || !this.plugin.db) {
			this.prevBtn.disabled = true;
			this.nextBtn.disabled = true;
			return;
		}
		
		try {
			// Check if previous exists
			const prevStmt = this.plugin.db.prepare("SELECT 1 FROM ldss WHERE ref_order = :order");
			prevStmt.bind({ ":order": this.currentRefOrder - 1 });
			this.prevBtn.disabled = !prevStmt.step();
			prevStmt.free();
			
			// Check if next exists
			const nextStmt = this.plugin.db.prepare("SELECT 1 FROM ldss WHERE ref_order = :order");
			nextStmt.bind({ ":order": this.currentRefOrder + 1 });
			this.nextBtn.disabled = !nextStmt.step();
			nextStmt.free();
		} catch (err) {
			console.error("Error updating nav buttons:", err);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

class ScriptureReferenceSuggestModal extends SuggestModal<string> {
	private plugin: StandardWorksPlugin;
	private onChoose: (reference: string) => void;
	private allReferences: string[] = [];

	constructor(app: App, plugin: StandardWorksPlugin, onChoose: (reference: string) => void) {
		super(app);
		this.plugin = plugin;
		this.onChoose = onChoose;
		this.setPlaceholder("Type a scripture reference (e.g., John 3, 1 Nephi 3:7)");
		this.buildReferenceList();
	}

	private async buildReferenceList(): Promise<void> {
		const refs: string[] = [];
		for (const [dataFile, books] of Object.entries(BOOKS_BY_FILE)) {
			const scriptureData = await this.plugin.getScriptureData(dataFile);
			for (const [, fullName] of Object.entries(books)) {
				if (!scriptureData[fullName]) continue;
				const chapters = Object.keys(scriptureData[fullName])
					.filter(k => k !== "heading")
					.map(Number)
					.sort((a, b) => a - b);
				for (const ch of chapters) {
					refs.push(`${fullName} ${ch}`);
				}
			}
		}
		this.allReferences = refs;
	}

	getSuggestions(query: string): string[] {
		const q = query.toLowerCase().trim();
		if (!q) return this.allReferences.slice(0, 50);

		// If query contains ':', expand matching chapter into per-verse suggestions
		if (q.includes(":")) {
			return this.getVerseSuggestions(q);
		}

		// Fuzzy match against chapter-level references
		return this.allReferences
			.filter(ref => {
				const refLower = ref.toLowerCase();
				// Check if all query chars appear in order (fuzzy)
				let qi = 0;
				for (let ri = 0; ri < refLower.length && qi < q.length; ri++) {
					if (refLower[ri] === q[qi]) qi++;
				}
				return qi === q.length;
			})
			.slice(0, 50);
	}

	private getVerseSuggestions(query: string): string[] {
		const colonIdx = query.lastIndexOf(":");
		const beforeColon = query.substring(0, colonIdx).trim();
		const versePrefix = query.substring(colonIdx + 1).trim();

		// Find which chapter-level ref matches the part before the colon
		const matchingChapter = this.allReferences.find(
			ref => ref.toLowerCase() === beforeColon
		) || this.allReferences.find(
			ref => ref.toLowerCase().startsWith(beforeColon)
		);

		if (!matchingChapter) return [];

		// Parse book and chapter from the matched ref
		const lastSpace = matchingChapter.lastIndexOf(" ");
		const bookName = matchingChapter.substring(0, lastSpace);
		const chapter = matchingChapter.substring(lastSpace + 1);
		const dataFile = BOOK_TO_FILE[bookName];
		if (!dataFile) return [];

		// Look up verses synchronously from cache (already loaded during buildReferenceList)
		const cached = this.plugin.getScriptureDataSync(dataFile);
		if (!cached || !cached[bookName] || !cached[bookName][chapter]) return [];

		const chapterData = cached[bookName][chapter] as { [key: string]: string };
		const verses = Object.keys(chapterData)
			.filter(k => k !== "heading")
			.map(Number)
			.sort((a, b) => a - b);

		return verses
			.filter(v => String(v).startsWith(versePrefix))
			.map(v => `${bookName} ${chapter}:${v}`)
			.slice(0, 50);
	}

	renderSuggestion(ref: string, el: HTMLElement): void {
		el.createEl("div", { text: ref });
	}

	onChooseSuggestion(ref: string): void {
		this.onChoose(ref);
	}
}

interface SearchResult {
	book: string;
	chapter: string;
	verse: string;
	text: string;
}

class ScriptureSearchModal extends Modal {
	plugin: StandardWorksPlugin;
	private searchResults: SearchResult[] = [];
	private currentPage: number = 0;
	private readonly resultsPerPage: number = 50;
	private resultsContainer: HTMLElement;
	private paginationContainer: HTMLElement;
	private searchTerm: string = "";
	private isRegex: boolean = false;
	private selectedIndex: number = -1;
	private inputEl: HTMLInputElement;
	private activeContextMenu: HTMLElement | null = null;
	private boundDismissMenu: ((e: Event) => void) | null = null;
	private scrollListenerAttached: boolean = false;
	
	// Checkboxes for each work
	private otCheckbox: HTMLInputElement;
	private ntCheckbox: HTMLInputElement;
	private bomCheckbox: HTMLInputElement;
	private dacCheckbox: HTMLInputElement;
	private pogpCheckbox: HTMLInputElement;
	private regexCheckbox: HTMLInputElement;

	constructor(app: App, plugin: StandardWorksPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		
		// Restore saved state
		if (this.plugin.lastSearchResults.length > 0) {
			this.searchResults = this.plugin.lastSearchResults;
			this.searchTerm = this.plugin.lastSearchTerm;
			this.currentPage = this.plugin.lastSearchPage;
			this.isRegex = this.plugin.lastSearchIsRegex;
		}
		
		// Make modal wider
		this.modalEl.addClass("scripture-search-modal");
		
		// Header row with title and regex toggle
		const headerRow = contentEl.createEl("div", { cls: "search-header-row" });
		headerRow.createEl("h2", { text: "Search Scriptures" });
		const regexLabel = headerRow.createEl("label", { cls: "search-regex-toggle" });
		this.regexCheckbox = regexLabel.createEl("input", { attr: { type: "checkbox" } });
		if (this.isRegex) this.regexCheckbox.checked = true;
		regexLabel.appendText(" Use Regex");
		
		// Search input container
		const searchContainer = contentEl.createEl("div", { cls: "search-input-container" });
		
		this.inputEl = searchContainer.createEl("input", {
			type: "text",
			attr: { 
				placeholder: "Enter search phrase or regex pattern...",
				value: this.searchTerm
			}
		});
		
		const searchBtn = searchContainer.createEl("button", { text: "Search" });
		
		// Checkboxes container
		const checkboxContainer = contentEl.createEl("div", { cls: "scripture-works-checkboxes" });
		
		// Create checkboxes for each work (restore saved state)
		this.otCheckbox = this.createCheckbox(checkboxContainer, "Old Testament", this.plugin.lastSelectedWorks.ot);
		this.ntCheckbox = this.createCheckbox(checkboxContainer, "New Testament", this.plugin.lastSelectedWorks.nt);
		this.bomCheckbox = this.createCheckbox(checkboxContainer, "Book of Mormon", this.plugin.lastSelectedWorks.bom);
		this.dacCheckbox = this.createCheckbox(checkboxContainer, "D&C", this.plugin.lastSelectedWorks.dac);
		this.pogpCheckbox = this.createCheckbox(checkboxContainer, "Pearl of Great Price", this.plugin.lastSelectedWorks.pogp);
		
		// Results container
		this.resultsContainer = contentEl.createEl("div", { cls: "search-results-container" });
		
		// Add scroll listener once and keep it active
		this.attachScrollListener();
		
		// Pagination container
		this.paginationContainer = contentEl.createEl("div", { cls: "pagination-container" });
		
		// Auto-focus on input and select existing text (deferred so modal is fully rendered)
		setTimeout(() => {
			this.inputEl.focus();
			this.inputEl.select();
		}, 0);
		
		// Keyboard handler for search input and result navigation
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && e.altKey && this.selectedIndex >= 0) {
				e.preventDefault();
				this.insertSelectedResultLink();
			} else if (e.key === "Enter" && this.selectedIndex === -1) {
				this.performSearch(this.inputEl.value);
			} else if (e.key === "Enter" && this.selectedIndex >= 0) {
				this.openSelectedResult();
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				this.moveSelection(1);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				this.moveSelection(-1);
			}
		});
		
		// Search on button click
		searchBtn.addEventListener("click", () => {
			this.performSearch(this.inputEl.value);
		});
		
		// Initial message or display saved results
		if (this.searchResults.length > 0) {
			this.displayResults();
			
			// Restore scroll position after rendering
			const savedScrollPosition = this.plugin.lastScrollPosition;
			setTimeout(() => {
				requestAnimationFrame(() => {
					this.resultsContainer.scrollTop = savedScrollPosition;
				});
			}, 100);
		} else {
			this.resultsContainer.createEl("p", { 
				text: "Enter a search phrase and click Search to find verses.",
				attr: { style: "color: var(--text-muted); text-align: center; margin-top: 20px;" }
			});
		}
	}
	
	private attachScrollListener() {
		if (this.scrollListenerAttached) return;
		
		this.resultsContainer.addEventListener("scroll", () => {
			this.plugin.lastScrollPosition = this.resultsContainer.scrollTop;
		});
		
		this.scrollListenerAttached = true;
	}
	
	private createCheckbox(container: HTMLElement, label: string, checked: boolean): HTMLInputElement {
		const labelEl = container.createEl("label");
		
		const checkbox = labelEl.createEl("input", {
			type: "checkbox"
		});
		checkbox.checked = checked;
		
		labelEl.appendText(label);
		
		return checkbox;
	}
	
	private async performSearch(searchPhrase: string) {
		if (!searchPhrase || !searchPhrase.trim()) {
			new Notice("Please enter a search phrase");
			return;
		}
		
		this.searchTerm = searchPhrase.trim();
		this.isRegex = this.regexCheckbox.checked;
		this.currentPage = 0;
		this.selectedIndex = -1;
		
		// Reset scroll position for new search
		this.plugin.lastScrollPosition = 0;
		
		// Show loading message
		this.resultsContainer.empty();
		this.resultsContainer.createEl("p", { 
			text: "Searching...",
			attr: { style: "color: var(--text-muted); text-align: center; margin-top: 20px;" }
		});
		
		// Get selected works
		const selectedWorks: string[] = [];
		if (this.otCheckbox.checked) selectedWorks.push("ot.json");
		if (this.ntCheckbox.checked) selectedWorks.push("nt.json");
		if (this.bomCheckbox.checked) selectedWorks.push("bom.json");
		if (this.dacCheckbox.checked) selectedWorks.push("dac.json");
		if (this.pogpCheckbox.checked) selectedWorks.push("pogp.json");
		
		if (selectedWorks.length === 0) {
			this.resultsContainer.empty();
			this.resultsContainer.createEl("p", { 
				text: "Please select at least one work to search.",
				attr: { style: "color: var(--text-error); text-align: center; margin-top: 20px;" }
			});
			return;
		}
		
		// Perform the search
		this.searchResults = await this.plugin.searchScriptures(this.searchTerm, selectedWorks, this.isRegex);
		
		// Save search state to plugin
		this.plugin.lastSearchTerm = this.searchTerm;
		this.plugin.lastSearchResults = this.searchResults;
		this.plugin.lastSearchIsRegex = this.isRegex;
		this.plugin.lastSelectedWorks = {
			ot: this.otCheckbox.checked,
			nt: this.ntCheckbox.checked,
			bom: this.bomCheckbox.checked,
			dac: this.dacCheckbox.checked,
			pogp: this.pogpCheckbox.checked
		};
		
		// Display results
		this.displayResults();
		
		// Restore scroll position after rendering (for new search, it will be 0)
		const savedScrollPosition = this.plugin.lastScrollPosition;
		setTimeout(() => {
			requestAnimationFrame(() => {
				this.resultsContainer.scrollTop = savedScrollPosition;
			});
		}, 100);
	}
	
	private displayResults() {
		this.resultsContainer.empty();
		
		if (this.searchResults.length === 0) {
			this.resultsContainer.createEl("p", { 
				text: `No results found for "${this.searchTerm}".`,
				attr: { style: "color: var(--text-muted); text-align: center; margin-top: 20px;" }
			});
			this.paginationContainer.empty();
			return;
		}
		
		// Show result count
		this.resultsContainer.createEl("div", { 
			text: `Found ${this.searchResults.length} result${this.searchResults.length === 1 ? '' : 's'}`,
			cls: "search-result-count"
		});
		
		// Calculate pagination
		const startIdx = this.currentPage * this.resultsPerPage;
		const endIdx = Math.min(startIdx + this.resultsPerPage, this.searchResults.length);
		const pageResults = this.searchResults.slice(startIdx, endIdx);
		
		// Display results for current page
		for (let i = 0; i < pageResults.length; i++) {
			const result = pageResults[i];
			const globalIndex = startIdx + i;
			const resultEl = this.resultsContainer.createEl("div", { cls: "search-result-item" });
			resultEl.dataset.index = String(globalIndex);
			
			if (globalIndex === this.selectedIndex) {
				resultEl.addClass("search-result-selected");
			}
			
			// Reference link
			const refLink = resultEl.createEl("a", { 
				text: `${result.book} ${result.chapter}:${result.verse}`,
				cls: "search-result-reference"
			});
			
			resultEl.addEventListener("click", (e) => {
				e.preventDefault();
				this.openResult(result);
			});
			
			resultEl.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.showResultContextMenu(e, result);
			});
			
			// Verse text with highlighted search term
			const textEl = resultEl.createEl("div", { cls: "search-result-text" });
			textEl.innerHTML = this.highlightText(result.text, this.searchTerm);
		}
		
		// Update pagination
		this.updatePagination();
	}
	
	private openResult(result: SearchResult) {
		const filename = `${result.book} ${result.chapter}.${result.verse}`;
		const files = this.app.vault.getFiles();
		let targetFile: TFile | null = null;
		
		for (const file of files) {
			if (file.name === `${filename}.md`) {
				targetFile = file;
				break;
			}
		}
		
		if (targetFile) {
			this.app.workspace.getLeaf('tab').openFile(targetFile);
			this.close();
		} else {
			new Notice(`Verse file not found: ${filename}`);
		}
	}
	
	private openSelectedResult() {
		if (this.selectedIndex < 0 || this.selectedIndex >= this.searchResults.length) return;
		this.openResult(this.searchResults[this.selectedIndex]);
	}
	
	private insertSelectedResultLink() {
		if (this.selectedIndex < 0 || this.selectedIndex >= this.searchResults.length) return;
		this.insertResultLink(this.searchResults[this.selectedIndex]);
	}
	
	private getResultLink(result: SearchResult): string {
		const filename = `${result.book} ${result.chapter}.${result.verse}`;
		const display = `${result.book} ${result.chapter}:${result.verse}`;
		return `[[${filename}|${display}]]`;
	}
	
	private insertResultLink(result: SearchResult) {
		const link = this.getResultLink(result);
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			const editor = activeView.editor;
			editor.replaceSelection(link);
			new Notice("Link inserted");
			this.close();
		} else {
			navigator.clipboard.writeText(link);
			new Notice("No active editor — link copied to clipboard");
		}
	}
	
	private showResultContextMenu(e: MouseEvent, result: SearchResult): void {
		this.dismissResultContextMenu();
		
		const menu = document.createElement("div");
		menu.className = "verse-context-menu";
		menu.style.left = `${e.clientX}px`;
		menu.style.top = `${e.clientY}px`;
		menu.style.zIndex = "var(--layer-notice)";
		
		const ref = `${result.book} ${result.chapter}:${result.verse}`;
		
		const insertLinkItem = menu.createDiv({ cls: "verse-context-menu-item", text: "Insert link" });
		insertLinkItem.addEventListener("click", () => {
			this.insertResultLink(result);
			this.dismissResultContextMenu();
		});
		
		const copyLinkItem = menu.createDiv({ cls: "verse-context-menu-item", text: "Copy link" });
		copyLinkItem.addEventListener("click", () => {
			navigator.clipboard.writeText(this.getResultLink(result));
			new Notice("Link copied");
			this.dismissResultContextMenu();
		});
		
		const copyRefItem = menu.createDiv({ cls: "verse-context-menu-item", text: "Copy reference" });
		copyRefItem.addEventListener("click", () => {
			navigator.clipboard.writeText(ref);
			new Notice("Reference copied");
			this.dismissResultContextMenu();
		});
		
		const copyTextItem = menu.createDiv({ cls: "verse-context-menu-item", text: "Copy verse text" });
		copyTextItem.addEventListener("click", () => {
			navigator.clipboard.writeText(result.text);
			new Notice("Verse text copied");
			this.dismissResultContextMenu();
		});
		
		const openNoteItem = menu.createDiv({ cls: "verse-context-menu-item", text: "Open note" });
		openNoteItem.addEventListener("click", () => {
			this.openResult(result);
			this.dismissResultContextMenu();
		});
		
		document.body.appendChild(menu);
		this.activeContextMenu = menu;
		
		this.boundDismissMenu = () => this.dismissResultContextMenu();
		setTimeout(() => {
			document.addEventListener("click", this.boundDismissMenu!);
			document.addEventListener("contextmenu", this.boundDismissMenu!);
		}, 0);
	}
	
	private dismissResultContextMenu(): void {
		if (this.activeContextMenu) {
			this.activeContextMenu.remove();
			this.activeContextMenu = null;
		}
		if (this.boundDismissMenu) {
			document.removeEventListener("click", this.boundDismissMenu);
			document.removeEventListener("contextmenu", this.boundDismissMenu);
			this.boundDismissMenu = null;
		}
	}
	
	private moveSelection(delta: number) {
		const startIdx = this.currentPage * this.resultsPerPage;
		const endIdx = Math.min(startIdx + this.resultsPerPage, this.searchResults.length);
		if (endIdx <= startIdx) return;
		
		// Remove previous selection highlight
		const prev = this.resultsContainer.querySelector(".search-result-selected");
		if (prev) prev.removeClass("search-result-selected");
		
		if (this.selectedIndex === -1) {
			// First navigation: select first or last depending on direction
			this.selectedIndex = delta > 0 ? startIdx : endIdx - 1;
		} else {
			this.selectedIndex += delta;
			// Clamp to current page bounds
			if (this.selectedIndex < startIdx) this.selectedIndex = startIdx;
			if (this.selectedIndex >= endIdx) this.selectedIndex = endIdx - 1;
		}
		
		// Apply selection highlight and scroll into view
		const el = this.resultsContainer.querySelector(`[data-index="${this.selectedIndex}"]`) as HTMLElement;
		if (el) {
			el.addClass("search-result-selected");
			el.scrollIntoView({ block: "nearest" });
		}
	}
	
	private highlightText(text: string, searchTerm: string): string {
		const escapeHtml = (str: string) => {
			const div = document.createElement('div');
			div.textContent = str;
			return div.innerHTML;
		};
		
		const escapedText = escapeHtml(text);
		
		if (this.isRegex) {
			// Try to extract actual search terms from lookaheads for highlighting
			// Pattern: (?=.*word) or (?=.*\bword\b) - extract the word
			const lookaheadMatches = searchTerm.matchAll(/\(\?=\.\*\\?b?([^)\\]+?)\\?b?\)/g);
			const termsToHighlight: string[] = [];
			
			for (const match of lookaheadMatches) {
				if (match[1]) {
					termsToHighlight.push(match[1]);
				}
			}
			
			// If we found lookahead terms, highlight each one
			if (termsToHighlight.length > 0) {
				let result = escapedText;
				for (const term of termsToHighlight) {
					try {
						const highlightRegex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
						result = result.replace(highlightRegex, '<mark style="background-color: var(--text-highlight-bg); color: var(--text-normal); padding: 2px 0;">$1</mark>');
					} catch {
						// Skip this term if it causes an error
					}
				}
				return result;
			}
			
			// Otherwise try to use the pattern directly (for simple regex)
			try {
				const regex = new RegExp(`(${searchTerm})`, 'gi');
				return escapedText.replace(regex, '<mark style="background-color: var(--text-highlight-bg); color: var(--text-normal); padding: 2px 0;">$1</mark>');
			} catch {
				// If regex is too complex or invalid for highlighting, just return text
				return escapedText;
			}
		} else {
			// Simple text search
			const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
			return escapedText.replace(regex, '<mark style="background-color: var(--text-highlight-bg); color: var(--text-normal); padding: 2px 0;">$1</mark>');
		}
	}
	
	private updatePagination() {
		this.paginationContainer.empty();
		
		const totalPages = Math.ceil(this.searchResults.length / this.resultsPerPage);
		
		if (totalPages <= 1) return;
		
		// Previous button
		const prevBtn = this.paginationContainer.createEl("button", { text: "Previous" });
		prevBtn.disabled = this.currentPage === 0;
		prevBtn.addEventListener("click", () => {
			if (this.currentPage > 0) {
				this.currentPage--;
				this.plugin.lastSearchPage = this.currentPage;
				this.plugin.lastScrollPosition = 0; // Reset scroll on page change
				this.displayResults();
				this.resultsContainer.scrollTop = 0;
			}
		});
		
		// Page info
		const pageInfo = this.paginationContainer.createEl("span", { 
			text: `Page ${this.currentPage + 1} of ${totalPages}`
		});
		
		// Next button
		const nextBtn = this.paginationContainer.createEl("button", { text: "Next" });
		nextBtn.disabled = this.currentPage >= totalPages - 1;
		nextBtn.addEventListener("click", () => {
			if (this.currentPage < totalPages - 1) {
				this.currentPage++;
				this.plugin.lastSearchPage = this.currentPage;
				this.plugin.lastScrollPosition = 0; // Reset scroll on page change
				this.displayResults();
				this.resultsContainer.scrollTop = 0;
			}
		});
	}

	onClose() {
		// Scroll position is already saved by the scroll listener - no need to re-read it
		
		// Save checkbox states (in case user toggled them without searching)
		if (this.otCheckbox) {
			this.plugin.lastSelectedWorks = {
				ot: this.otCheckbox.checked,
				nt: this.ntCheckbox.checked,
				bom: this.bomCheckbox.checked,
				dac: this.dacCheckbox.checked,
				pogp: this.pogpCheckbox.checked
			};
		}
		
		// Save regex checkbox state
		if (this.regexCheckbox) {
			this.plugin.lastSearchIsRegex = this.regexCheckbox.checked;
		}
		
		this.dismissResultContextMenu();
		this.contentEl.empty();
	}
}

class StandardWorksPluginSettingTab extends PluginSettingTab {
	plugin: StandardWorksPlugin;

	constructor(app: App, plugin: StandardWorksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Standard Works Plugin Settings" });

		new Setting(containerEl)
			.setName("Order Backlinks")
			.setDesc("Automatically sort backlinks by scripture reference order.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.orderBacklinks)
				.onChange(async (value) => {
					this.plugin.settings.orderBacklinks = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Linkify: sentences to scan")
			.setDesc("When running 'Linkify scripture references' with no text selected, scan this many sentences backward from the cursor for scripture references. Default: 1. Max: 10.")
			.addText(text => text
				.setPlaceholder("1")
				.setValue(String(this.plugin.settings.linkifySentencesToScan ?? 1))
				.onChange(async (value) => {
					const parsed = parseInt(value, 10);
					if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
						this.plugin.settings.linkifySentencesToScan = parsed;
						await this.plugin.saveSettings();
					}
				}));

		containerEl.createEl("h3", { text: "Translation Languages" });
		containerEl.createEl("p", {
			text: "Select which languages to display in the Translations view.",
			attr: { style: "color: var(--text-muted); margin-bottom: 10px;" }
		});

		const langGrid = containerEl.createDiv({ cls: "translation-settings-grid" });
		for (const [code, name] of Object.entries(LANGUAGES)) {
			const label = langGrid.createEl("label", { cls: "translation-settings-item" });
			const cb = label.createEl("input", { attr: { type: "checkbox" } });
			cb.checked = this.plugin.settings.translationLanguages.includes(code);
			label.createSpan({ text: `${name} (${code})` });

			cb.addEventListener("change", async () => {
				if (cb.checked) {
					if (!this.plugin.settings.translationLanguages.includes(code)) {
						this.plugin.settings.translationLanguages.push(code);
					}
				} else {
					this.plugin.settings.translationLanguages = this.plugin.settings.translationLanguages.filter(l => l !== code);
				}
				await this.plugin.saveSettings();
				this.plugin.refreshTranslationView();
			});
		}
	}
}