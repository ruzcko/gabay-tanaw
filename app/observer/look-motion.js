/** Display camera motion only: keep the horizon level and take the shorter azimuth turn. */
export function interpolateLook(from, to, progress) {
  const t = Math.max(0, Math.min(1, progress)), eased = t * t * (3 - 2 * t);
  const turn = ((to.yaw - from.yaw + 540) % 360 + 360) % 360 - 180;
  return { yaw: from.yaw + turn * eased, pitch: from.pitch + (to.pitch - from.pitch) * eased };
}
