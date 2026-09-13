/**
 * Exponential target-following interpolation.
 * NOT a buffered timestamped interpolator — see README/ARCHITECTURE.
 *
 * current += (target - current) * alpha
 * where alpha is normalized to the frame rate.
 */
export const DEFAULT_SMOOTHING = 0.2;
const SNAP_EPSILON = 1e-3;

export function smoothingAlpha(
  smoothing: number,
  dtMs: number,
  referenceFrameMs = 16.67,
): number {
  const clamped = Math.min(1, Math.max(0, smoothing));
  // alpha = 1 - (1 - s)^(dt / ref)
  return 1 - Math.pow(1 - clamped, dtMs / referenceFrameMs);
}

export function step(current: number, target: number, alpha: number): number {
  const next = current + (target - current) * alpha;
  if (Math.abs(target - next) < SNAP_EPSILON) return target;
  return next;
}
