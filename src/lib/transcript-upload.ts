export const TRANSCRIPT_EXTENSIONS = ['.txt', '.md', '.srt', '.vtt'] as const;
export const TRANSCRIPT_ACCEPT = TRANSCRIPT_EXTENSIONS.join(',');
export const MAX_TRANSCRIPT_FILE_SIZE = 5 * 1024 * 1024;

/** Read locally; the existing meeting API receives the reviewed text on submission. */
export async function readTranscriptFile(file: File): Promise<string> {
	const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
	if (!TRANSCRIPT_EXTENSIONS.some((supported) => supported === extension)) {
		throw new Error('Unsupported file type. Choose a .txt, .md, .srt, or .vtt file.');
	}
	if (file.size > MAX_TRANSCRIPT_FILE_SIZE) {
		throw new Error('The transcript file is too large. The maximum size is 5 MB.');
	}

	let buffer: ArrayBuffer;
	try {
		buffer = await file.arrayBuffer();
	} catch {
		throw new Error('Could not read the file. Please try selecting it again.');
	}

	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
	} catch {
		throw new Error('Could not read the transcript as UTF-8 text. Save it as UTF-8 and try again.');
	}

	// Reject binary content even when a file has an accepted extension.
	if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
		throw new Error('The file contains non-text content. Choose a UTF-8 transcript file.');
	}
	text = text.replace(/\r\n?/g, '\n');
	if (!text.trim()) {
		throw new Error('The transcript file is empty. Choose a file containing transcript text.');
	}
	return text;
}
