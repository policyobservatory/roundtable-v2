export type AIProvider = 'workers-ai' | 'openrouter' | 'llmapi';
export type STTProvider = 'huggingface' | 'deepgram' | 'whisper' | 'elevenlabs';

export interface MeetingNode {
	id: string;
	title: string;
	summary: string;
	x?: number;
	y?: number;
	children?: MeetingNode[];
}

export interface MeetingMap {
	nodes: MeetingNode[];
	edges?: { source: string; target: string }[];
}

export interface AnalysisChunk {
	id: string;
	meeting_id: string;
	chunk_index: number;
	start_offset: number;
	end_offset: number;
	summary: string;
	nodes: MeetingNode[];
	created_at: string;
}

export interface Meeting {
	id: string;
	title: string;
	status: 'pending' | 'analyzing' | 'completed' | 'error';
	provider: AIProvider;
	model: string;
	transcript_key: string;
	segmented: number; // boolean stored as 0/1
	metadata: Record<string, unknown>;
	map?: MeetingMap;
	error?: string;
	created_at: string;
	updated_at: string;
}

export interface Segment {
	id: string;
	meeting_id: string;
	segment_index: number;
	text: string;
	audio_key?: string;
	status: 'pending' | 'transcribed' | 'analyzed';
	created_at: string;
}

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}
