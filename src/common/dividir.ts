/**
 * Divide `total` pontos inteiros entre `n` pessoas o mais igual possível: cada
 * uma leva `floor(total / n)` e a sobra vai, 1 ponto por vez, às primeiras da
 * lista. A soma das partes é sempre exatamente `total` (nenhum ponto some nem é
 * criado). Spec 033: a ordem é a cronológica, então a sobra vai a quem
 * denunciou primeiro.
 */
export function dividirIgual(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const sobra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < sobra ? 1 : 0));
}
