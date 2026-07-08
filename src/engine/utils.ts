export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export const rnd = (a: number, b: number): number => Math.random() * (b - a) + a;

export const money = (v: number): string => Math.max(0, Math.round(v)).toLocaleString('en-US');
