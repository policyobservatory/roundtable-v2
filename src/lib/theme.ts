export type Theme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'roundtable-theme';
export const THEME_CONTEXT = Symbol('roundtable-theme');
export interface ThemeContext {
	readonly dark: boolean;
	readonly ready: boolean;
	toggle: () => void;
}
export function isTheme(value: unknown): value is Theme {
	return value === 'light' || value === 'dark';
}
