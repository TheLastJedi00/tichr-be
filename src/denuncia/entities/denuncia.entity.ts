import { BadRequestException, ConflictException } from '@nestjs/common';
import { DENUNCIA } from '../denuncia.constants';
import { DenunciaTopicoEntity } from './denuncia-topico.entity';

export type StatusDenuncia = 'PENDENTE' | 'VALIDADA' | 'INVALIDADA';

/**
 * Denúncia de um aluno contra um colega da mesma turma (spec 032). Coleção
 * fechada ao cliente: o autor só chega ao professor (anonimato, #3).
 */
export class DenunciaEntity {
  id: string;
  turmaId: string;
  professorId: string;
  autorAlunoId: string;
  denunciadoAlunoId: string;
  topicoId?: string;
  /** Cópia do título: sobrevive à edição e ao arquivamento do tópico. */
  topicoTitulo?: string;
  texto?: string;
  /** Janela de denúncia em que foi feita (033). */
  janelaId?: string;
  /** Grupo de denúncias contra o mesmo aluno (033); null ao sair dele. */
  grupoId?: string | null;
  /** Caminho privado no Storage; apagado ao resolver (#5). */
  imagemPath?: string;
  status: StatusDenuncia = 'PENDENTE';
  criadaEm: string;
  resolvidaEm?: string;
  /** O que o professor escolheu. */
  pontos?: number;
  /** O que de fato saiu do denunciado (#2): nunca mais que o XP dele. */
  pontosTransferidos?: number;

  constructor(partial: Partial<DenunciaEntity> = {}) {
    Object.assign(this, partial);
  }

  get pendente(): boolean {
    return this.status === 'PENDENTE';
  }

  /**
   * Monta uma denúncia nova aplicando as travas de abuso (#4). `pendentesDoAutor`
   * são as denúncias PENDENTES que o autor já tem.
   */
  static criar(
    dados: {
      turmaId: string;
      professorId: string;
      autorAlunoId: string;
      denunciadoAlunoId: string;
      topico?: DenunciaTopicoEntity | null;
      texto?: string;
    },
    pendentesDoAutor: DenunciaEntity[],
    agora = new Date(),
  ): DenunciaEntity {
    if (dados.autorAlunoId === dados.denunciadoAlunoId) {
      throw new BadRequestException({
        code: 'AUTODENUNCIA',
        message: 'Você não pode denunciar a si mesmo.',
      });
    }
    const texto = dados.texto?.trim() || undefined;
    if (texto && texto.length > DENUNCIA.TEXTO_MAX) {
      throw new BadRequestException(
        `A denúncia pode ter até ${DENUNCIA.TEXTO_MAX} caracteres.`,
      );
    }
    if (!texto && !dados.topico) {
      throw new BadRequestException({
        code: 'DENUNCIA_VAZIA',
        message: 'Escolha um tópico ou escreva o que aconteceu.',
      });
    }
    const pendentes = pendentesDoAutor.filter((d) => d.pendente);
    if (
      pendentes.some((d) => d.denunciadoAlunoId === dados.denunciadoAlunoId)
    ) {
      throw new BadRequestException({
        code: 'DENUNCIA_DUPLICADA',
        message: 'Você já tem uma denúncia pendente contra esse colega.',
      });
    }
    if (pendentes.length >= DENUNCIA.MAX_PENDENTES) {
      throw new BadRequestException({
        code: 'LIMITE_PENDENTES',
        message: `Você já tem ${DENUNCIA.MAX_PENDENTES} denúncias aguardando o professor.`,
      });
    }
    const d = new DenunciaEntity({
      turmaId: dados.turmaId,
      professorId: dados.professorId,
      autorAlunoId: dados.autorAlunoId,
      denunciadoAlunoId: dados.denunciadoAlunoId,
      status: 'PENDENTE',
      criadaEm: agora.toISOString(),
    });
    if (dados.topico) {
      d.topicoId = dados.topico.id;
      d.topicoTitulo = dados.topico.titulo;
    }
    if (texto) d.texto = texto;
    return d;
  }

  /** Resolver duas vezes é 409: a transferência de XP não pode repetir. */
  assertPendente(): void {
    if (!this.pendente) {
      throw new ConflictException({
        code: 'DENUNCIA_RESOLVIDA',
        message: 'Essa denúncia já foi resolvida.',
      });
    }
  }

  /** Quanto sai do denunciado: o pedido, limitado ao XP dele (#2). */
  static aTransferir(pontos: number, xpDenunciado: number): number {
    return Math.max(0, Math.min(pontos, xpDenunciado));
  }
}
