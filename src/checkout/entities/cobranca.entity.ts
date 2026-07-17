import type { PlanoAtual } from '../../professor/entities/professor.entity';
import type { StatusPagamento } from '../abacate-pay.service';

/** O que a cobranca concede quando paga. */
export type TipoCobranca = 'UPGRADE' | 'SLOT';

/** Meio de pagamento escolhido. */
export type MetodoCobranca = 'PIX' | 'CARTAO';

/**
 * Intencao de compra registrada em `cobrancas/{id}`. O `id` e o identificador da
 * cobranca no gateway (id do PIX ou do checkout na Abacate Pay). E a **fonte da
 * idempotencia**: o webhook credita a partir deste doc, nao do payload, e marca
 * `PAID` numa transacao — um segundo evento para o mesmo id nao credita de novo.
 */
export class CobrancaEntity {
  id: string;
  professorId: string;

  /** UPGRADE concede um plano; SLOT concede uma vaga avulsa. */
  tipo: TipoCobranca;

  /** Plano a conceder (apenas UPGRADE). */
  planoAlvo?: PlanoAtual;

  valorCentavos: number;
  metodo: MetodoCobranca;

  /** Codigo de cupom aplicado na cobranca (desconto no gateway), se houver. */
  cupom?: string;

  status: StatusPagamento = 'PENDING';
  criadoEm: string;

  /** Data de aprovacao (ISO), gravada pelo webhook ao conceder. */
  pagoEm?: string;

  constructor(partial: Partial<CobrancaEntity> = {}) {
    Object.assign(this, partial);
  }
}
