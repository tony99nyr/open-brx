import type { ModeInfo } from '../api/types';

/** mcp/brx_mcp/modes/registry.py default_params() and mc/config_merge.py _mode_params(). */
export function defaultModeParams(mode: ModeInfo): Record<string, number | boolean | string> {
  return Object.fromEntries(mode.params.map(param => [param.name, param.default]));
}

export function mergeModeParams(mode: ModeInfo, current: Record<string, unknown> | undefined,
  patch: Record<string, unknown>): Record<string, number | boolean | string> | undefined {
  if (patch !== null && (typeof patch !== 'object' || Array.isArray(patch)))
    throw new Error('mode_params must be an object (the mode\'s parameters, GET /api/modes .params)');
  const merged = { ...current, ...patch };
  const errors: string[] = [];
  const known = mode.params.map(param => param.name).sort();
  const repr = (value: unknown) => typeof value === 'string' ? `'${value}'` : String(value);
  for (const key of Object.keys(merged)) {
    if (known.includes(key)) continue;
    errors.push(known.length
      ? `mode '${mode.mode}' has no parameter '${key}' — its parameters are: ${known.join(', ')}`
      : `mode '${mode.mode}' takes no mode_params, so '${key}' would be a control that does nothing`);
  }
  const resolved: Record<string, number | boolean | string> = {};
  for (const param of mode.params) {
    const value = merged[param.name] ?? param.default;
    const name = `mode_params.${param.name}`;
    let error: string | null = null;
    if (param.type === 'bool') {
      if (typeof value !== 'boolean') error = `${name} must be true or false, not ${repr(value)}`;
    } else if (param.type === 'str') {
      if (typeof value !== 'string' || !value || value.length > 64)
        error = `${name} must be a short non-empty string, not ${repr(value)}`;
      else if (param.choices?.length && !param.choices.includes(value))
        error = `${name} must be one of ${param.choices.join(', ')}, not ${repr(value)}`;
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      error = `${name} must be a number, not ${repr(value)}`;
    } else if (param.type === 'int' && !Number.isInteger(value)) {
      error = `${name} must be a whole number, not ${repr(value)}`;
    } else if (param.min != null && value < param.min) {
      error = `${name} must be at least ${param.min}, not ${value}`;
    } else if (param.max != null && value > param.max) {
      error = `${name} must be at most ${param.max}, not ${value}`;
    }
    if (error) errors.push(`mode '${mode.mode}': ${error}`);
    else resolved[param.name] = value as number | boolean | string;
  }
  if (errors.length) throw new Error(errors.join('; '));
  return Object.keys(resolved).length ? resolved as Record<string, number | boolean | string> : undefined;
}
