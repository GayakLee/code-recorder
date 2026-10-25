// Copyright (c) 2026 GayakLee and code-recorder contributors. MIT licensed.
class Camera {
  constructor() { this.from = this.to = { scale: 1, x: 0.5, y: 0.5 }; this.started = 0; this.duration = 0; }
  state(now = performance.now()) {
    const t = this.duration ? Math.min(1, Math.max(0, (now - this.started) / this.duration)) : 1;
    const ease = t * t * (3 - 2 * t);
    const value = Object.fromEntries(['scale', 'x', 'y'].map(k => [k, this.from[k] + (this.to[k] - this.from[k]) * ease]));
    return { ...value, transitioning: t < 1, target: { ...this.to } };
  }
  update(input) {
    const action = input.action ?? (['scale', 'x', 'y'].some(k => input[k] !== undefined) ? 'set' : 'state');
    if (!['set', 'in', 'out', 'reset', 'state'].includes(action)) throw new Error('Unknown camera action');
    if (action === 'state') return this.state();
    const current = this.state();
    const factor = input.factor ?? 1.5;
    if (!Number.isFinite(factor) || factor <= 1 || factor > 8) throw new Error('Camera factor must be greater than 1 and at most 8');
    const next = action === 'reset' ? { scale: 1, x: 0.5, y: 0.5 } : {
      scale: action === 'in' ? current.scale * factor : action === 'out' ? Math.max(1, current.scale / factor) : (input.scale ?? current.scale),
      x: input.x ?? current.x, y: input.y ?? current.y,
    };
    const duration = input.durationMs ?? 0;
    if (!Number.isFinite(next.scale) || next.scale < 1 || next.scale > 8 || ![next.x, next.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1) || !Number.isInteger(duration) || duration < 0 || duration > 10000) throw new Error('Camera scale 1-8, normalized center 0-1 and duration 0-10000 ms are required');
    this.from = { scale: current.scale, x: current.x, y: current.y }; this.to = next; this.started = performance.now(); this.duration = duration;
    return this.state();
  }
  rect(width, height) {
    const state = this.state();
    const w = Math.max(1, Math.round(width / state.scale)); const h = Math.max(1, Math.round(height / state.scale));
    return { x: Math.max(0, Math.min(width - w, Math.round(state.x * width - w / 2))), y: Math.max(0, Math.min(height - h, Math.round(state.y * height - h / 2))), width: w, height: h };
  }
}
module.exports = { Camera };
