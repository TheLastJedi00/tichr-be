import { PlanoAtual } from '../professor/entities/professor.entity';

/**
 * Catálogo de preços — **fonte de verdade da cobrança**, em centavos. O front
 * tem os mesmos valores só para exibição (`planos.data.ts`); quem monta o valor
 * cobrado no gateway é o backend, para o preço nunca vir do cliente.
 *
 * Espelha a vitrine: Estagiário grátis, Graduado R$ 19,90, Mestre R$ 39,90,
 * PhD R$ 59,90 — todos mensais (a recorrência é PIX one-time por mês).
 */
export const PRECOS_PLANO: Record<PlanoAtual, number> = {
  ESTAGIARIO: 0,
  GRADUADO: 1990,
  MESTRE: 3990,
  PHD: 5990,
};

/**
 * Preço da vaga de turma avulsa (compra única, permanente — fora do ciclo
 * mensal do plano). Sem referência na vitrine; definido aqui como R$ 9,90.
 */
export const PRECO_SLOT_AVULSO = 990;

/** Valor cobrável de um plano, em centavos (0 = gratuito, não gera cobrança). */
export function valorDoPlano(plano: PlanoAtual): number {
  return PRECOS_PLANO[plano] ?? 0;
}

/** Valor da vaga avulsa, em centavos. */
export function valorSlot(): number {
  return PRECO_SLOT_AVULSO;
}
