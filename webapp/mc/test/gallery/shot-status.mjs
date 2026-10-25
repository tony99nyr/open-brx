export function shotFailed(log) {
  return log.some(line => line.startsWith('PAGEERROR') || line.startsWith('OPEN-MISS'));
}
