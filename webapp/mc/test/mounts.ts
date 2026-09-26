// Every root the harness mounts, so `setup.ts` can unmount what a test left behind. A screen left
// mounted keeps its timers and pending fetches alive (LIVE ticks every 500 ms; RECAP awaits
// matchHistory), and one that fires after the file's jsdom is torn down fails the run with
// "window is not defined" in whichever test happens to be running (the end-delivery flake, 2026-09-25).
export const liveMounts = new Set<() => void>();

export function unmountAll(): void {
  for (const unmount of [...liveMounts]) unmount();
  liveMounts.clear();
}
