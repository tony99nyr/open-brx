import type { StartView } from '../api/types';

// Server: state.py Session._start_view() returns null without a match head.
export const sessionStartView = (view?: StartView | null): StartView | null => view ?? null;
