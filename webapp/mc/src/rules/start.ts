import type { StartView } from '../api/types';

// The backend checks for a match head before passing its view here.
export const sessionStartView = (view?: StartView | null): StartView | null => view ?? null;
