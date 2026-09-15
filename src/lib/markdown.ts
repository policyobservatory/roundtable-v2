import MarkdownIt from 'markdown-it';

// Model output is untrusted: escape raw HTML and retain markdown-it's safe URL validation.
const markdown = new MarkdownIt({ html: false, breaks: true });

export function renderMarkdown(content: string): string {
	return markdown.render(content);
}
