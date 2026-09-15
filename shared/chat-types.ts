import type { AIProvider } from './types';

export interface ChatSession {
	id: string;
	meeting_id: string;
	title: string;
	provider: AIProvider;
	model: string;
	created_at: string;
	updated_at: string;
}
export interface SavedChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	position: number;
	turn_id: string | null;
	created_at: string;
}
export interface ChatTurn {
	id: string;
	session_id: string;
	position: number;
	content: string;
	provider: AIProvider;
	model: string;
	status: 'pending' | 'complete' | 'error';
	error: string | null;
	lease_until: number;
	created_at: string;
	updated_at: string;
}
export interface ChatSessionData {
	session: ChatSession;
	messages: SavedChatMessage[];
	before: number | null;
	latestTurn: ChatTurn | null;
}
export interface SendChatTurn {
	id: string;
	content: string;
	provider: AIProvider;
	model: string;
}
