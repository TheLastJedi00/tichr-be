import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ExtensaoAnexo } from '../../common/anexo';
import { TRABALHO } from '../trabalho.constants';
import type { AtividadeEntity } from './atividade.entity';

export interface ArquivoEntrega {
  id: string;
  /** Privado no Storage; nunca sai na resposta. */
  path: string;
  nome: string;
  extensao: ExtensaoAnexo;
  tamanho: number;
  enviadoEm: string;
}

export interface AvaliacaoEntrega {
  nota: number;
  comentario?: string | null;
  avaliadaEm: string;
  /** O que de fato entrou no ranking (o XP nunca fica negativo). */
  xpCreditado: number;
}

/** Estado da entrega na ótica do aluno e da lista do professor. */
export type EstadoEntrega = 'PENDENTE' | 'ENTREGUE' | 'AVALIADA' | 'PERDIDA';

/**
 * Entrega de um aluno a uma atividade (spec 038). Uma por aluno, com id
 * `{atividadeId}_{alunoId}` (#6): dois envios simultâneos caem no mesmo doc.
 */
export class EntregaEntity {
  id: string;
  atividadeId: string;
  turmaId: string;
  alunoId: string;
  texto?: string | null;
  arquivos: ArquivoEntrega[] = [];
  criadaEm: string;
  atualizadaEm: string;
  avaliacao?: AvaliacaoEntrega | null;

  constructor(partial: Partial<EntregaEntity> = {}) {
    Object.assign(this, partial);
    this.arquivos = this.arquivos ?? [];
  }

  static idDe(atividadeId: string, alunoId: string): string {
    return `${atividadeId}_${alunoId}`;
  }

  static nova(
    dados: { atividadeId: string; turmaId: string; alunoId: string },
    agora = new Date(),
  ): EntregaEntity {
    const iso = agora.toISOString();
    return new EntregaEntity({
      id: EntregaEntity.idDe(dados.atividadeId, dados.alunoId),
      ...dados,
      texto: null,
      arquivos: [],
      criadaEm: iso,
      atualizadaEm: iso,
      avaliacao: null,
    });
  }

  /** Conta como entregue com texto ou ao menos um arquivo (#7). */
  get entregue(): boolean {
    return !!this.texto?.trim() || this.arquivos.length > 0;
  }

  get avaliada(): boolean {
    return !!this.avaliacao;
  }

  /** Edição até o prazo ou a avaliação, o que vier primeiro (#10). */
  garantirEditavel(atividade: AtividadeEntity, agora = new Date()): void {
    if (this.avaliada) {
      throw new ConflictException({
        code: 'ENTREGA_AVALIADA',
        message: 'Este trabalho já foi avaliado e não pode mais ser alterado.',
      });
    }
    if (!atividade.aberta(agora)) {
      throw new ForbiddenException({
        code: 'PRAZO_ENCERRADO',
        message: 'O prazo deste trabalho já acabou.',
      });
    }
  }

  /** Canva em texto puro (#8); vazio apaga o texto. */
  definirTexto(texto: string | null | undefined, agora = new Date()): void {
    const t = texto ?? '';
    if (t.length > TRABALHO.TEXTO_MAX) {
      throw new BadRequestException({
        code: 'TEXTO_GRANDE',
        message: `O texto pode ter até ${TRABALHO.TEXTO_MAX.toLocaleString('pt-BR')} caracteres.`,
      });
    }
    this.texto = t.trim() ? t : null;
    this.atualizadaEm = agora.toISOString();
  }

  adicionarArquivo(arquivo: ArquivoEntrega, agora = new Date()): void {
    if (this.arquivos.length >= TRABALHO.MAX_ARQUIVOS) {
      throw new ConflictException({
        code: 'LIMITE_ARQUIVOS',
        message: `Cada entrega pode ter até ${TRABALHO.MAX_ARQUIVOS} arquivos.`,
      });
    }
    this.arquivos.push(arquivo);
    this.atualizadaEm = agora.toISOString();
  }

  arquivo(arquivoId: string): ArquivoEntrega {
    const a = this.arquivos.find((x) => x.id === arquivoId);
    if (!a) {
      throw new NotFoundException({
        code: 'ARQUIVO_NAO_ENCONTRADO',
        message: 'Arquivo não encontrado.',
      });
    }
    return a;
  }

  removerArquivo(arquivoId: string, agora = new Date()): ArquivoEntrega {
    const a = this.arquivo(arquivoId);
    this.arquivos = this.arquivos.filter((x) => x.id !== arquivoId);
    this.atualizadaEm = agora.toISOString();
    return a;
  }

  /**
   * Grava a nota e o comentário (#14) e devolve o XP a creditar (#15–#17):
   * a diferença entre o alvo `round(nota/10 × valor)` e o já creditado. Com a
   * pontuação desligada (ou valor 0), nada entra e nada do que entrou sai.
   * O chamador aplica o delta e informa o real com `registrarCredito`.
   */
  avaliar(
    dados: { nota: number; comentario?: string | null },
    cfg: { valorPontos: number; pontuacaoAtiva: boolean },
    agora = new Date(),
  ): number {
    const nota = dados.nota;
    if (
      typeof nota !== 'number' ||
      !Number.isFinite(nota) ||
      nota < 0 ||
      nota > TRABALHO.NOTA_MAX ||
      Math.abs(nota * 10 - Math.round(nota * 10)) > 1e-9
    ) {
      throw new BadRequestException({
        code: 'NOTA_INVALIDA',
        message: 'A nota vai de 0 a 10, com até uma casa decimal.',
      });
    }
    const comentario = (dados.comentario ?? '').trim();
    if (comentario.length > TRABALHO.COMENTARIO_MAX) {
      throw new BadRequestException({
        code: 'COMENTARIO_GRANDE',
        message: `O comentário pode ter até ${TRABALHO.COMENTARIO_MAX} caracteres.`,
      });
    }
    if (!this.entregue) {
      throw new BadRequestException({
        code: 'ENTREGA_VAZIA',
        message: 'Só é possível avaliar um trabalho entregue.',
      });
    }
    const jaCreditado = this.avaliacao?.xpCreditado ?? 0;
    this.avaliacao = {
      nota,
      comentario: comentario || null,
      avaliadaEm: agora.toISOString(),
      xpCreditado: jaCreditado,
    };
    if (!cfg.pontuacaoAtiva || cfg.valorPontos <= 0) return 0;
    const alvo = Math.round((nota / TRABALHO.NOTA_MAX) * cfg.valorPontos);
    return alvo - jaCreditado;
  }

  /** Soma ao `xpCreditado` o que de fato entrou (ou saiu) do ranking. */
  registrarCredito(aplicado: number): void {
    if (!this.avaliacao) return;
    this.avaliacao.xpCreditado += aplicado;
  }
}

/** PENDENTE / ENTREGUE / AVALIADA / PERDIDA (prazo passou sem entrega). */
export function estadoDaEntrega(
  atividade: AtividadeEntity,
  entrega: EntregaEntity | null | undefined,
  agora = new Date(),
): EstadoEntrega {
  if (entrega?.avaliada) return 'AVALIADA';
  if (entrega?.entregue) return 'ENTREGUE';
  return atividade.aberta(agora) ? 'PENDENTE' : 'PERDIDA';
}
