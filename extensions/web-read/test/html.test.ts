import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../html";

describe("htmlToMarkdown", () => {
	it("removes embedded images", () => {
		const markdown = htmlToMarkdown(`
			<main>
				<img alt="captcha" src="data:image/png;base64,${"a".repeat(50_000)}">
				<p>Readable content</p>
			</main>
		`);

		expect(markdown).toBe("Readable content");
	});

	it("keeps linked images with useful alt text", () => {
		const markdown = htmlToMarkdown(
			'<img alt="System diagram" src="https://example.com/diagram.png">',
		);

		expect(markdown).toBe("![System diagram](https://example.com/diagram.png)");
	});

	it("removes hidden content", () => {
		const markdown = htmlToMarkdown(`
			<p hidden>Duplicate mobile navigation</p>
			<p aria-hidden="true">Decorative label</p>
			<p inert>Inactive dialog</p>
			<p>Readable content</p>
		`);

		expect(markdown).toBe("Readable content");
	});
});
