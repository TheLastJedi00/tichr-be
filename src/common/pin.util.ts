/**
 * Smart PINs: identificadores curtos de 2 dígitos (mais fáceis de memorizar na
 * hora do login em aula). Limites estruturais que sustentam o formato curto.
 */
export const LIMITE_TURMAS_ATIVAS = 99;
export const LIMITE_ALUNOS_TURMA = 99;

/**
 * Menor PIN de 2 dígitos ('01'..'99') fora de `usados`, ou `null` se os 99 já
 * estão em uso. Gera sequências curtas e reaproveita lacunas.
 */
export function proximoPinCurto(usados: Set<string>): string | null {
  for (let n = 1; n <= 99; n++) {
    const pin = String(n).padStart(2, '0');
    if (!usados.has(pin)) return pin;
  }
  return null;
}

/** true se o PIN não está no formato curto (2 díg) — turma/aluno legado (6/4 díg). */
export function pinEhLegado(pin?: string): boolean {
  return !!pin && !/^\d{2}$/.test(pin);
}
