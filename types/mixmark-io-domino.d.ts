declare module "@mixmark-io/domino" {
	interface DominoElement {
		getAttribute(name: string): string | null;
		querySelector(selector: string): DominoElement | null;
		closest(selector: string): DominoElement | null;
		readonly textContent: string | null;
	}

	interface DominoDocument {
		querySelector(selector: string): DominoElement | null;
		querySelectorAll(selector: string): ArrayLike<DominoElement>;
	}

	const domino: {
		createDocument(html?: string, force?: boolean): DominoDocument;
	};

	export default domino;
}
