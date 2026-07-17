import type { PlanoAtual } from '../../professor/entities/professor.entity';

/** Tipo de benefIcio do cupom. */
export type TipoCupom = 'PLANO_GRATIS' | 'MESES_GRATIS';

/** Tipo de desconto do cupom no gateway (Abacate Pay). */
export type TipoDesconto = 'PERCENTAGE' | 'FIXED';

/**
 * Cupom promocional. Documento em `cupons`. O `codigo` e normalizado em
 * maiUsculas e serve de chave de busca no checkout.
 */
export class CupomEntity {
  id: string;
  codigo: string;

  /** PLANO_GRATIS concede um plano; MESES_GRATIS libera meses de cortesia. */
  tipo: TipoCupom;

  /** Plano concedido (PLANO_GRATIS, ou junto de MESES_GRATIS para dar upgrade). */
  planoConcedido?: PlanoAtual;

  /** Quantidade de meses de cortesia (MESES_GRATIS). */
  meses?: number;

  ativo = true;
  usos = 0;

  /** Limite de usos; indefinido = ilimitado. */
  maxUsos?: number;

  /**
   * Id do cupom espelhado na Abacate Pay. Preenchido quando o gateway esta
   * configurado — permite aplicar o desconto na cobranca (`coupons` no checkout).
   */
  abacateCupomId?: string;

  /** Tipo de desconto no gateway (default PERCENTAGE 100 = cortesia total). */
  discountKind?: TipoDesconto;

  /** Valor do desconto: 1-100 para PERCENTAGE; centavos para FIXED. */
  discount?: number;

  constructor(partial: Partial<CupomEntity> = {}) {
    Object.assign(this, partial);
  }

  /** Cupom disponIvel para uso (ativo e dentro do limite). */
  estaValido(): boolean {
    if (!this.ativo) return false;
    if (this.maxUsos != null && (this.usos ?? 0) >= this.maxUsos) return false;
    return true;
  }

  static normalizar(codigo: string): string {
    return codigo.trim().toUpperCase();
  }
}
