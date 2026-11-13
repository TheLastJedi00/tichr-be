import { BadRequestException, ConflictException } from '@nestjs/common';
import { dividirIgual } from '../../common/dividir';
import { DenunciaEntity } from './denuncia.entity';

export type StatusGrupo = 'PENDENTE' | 'VALIDADO' | 'INVALIDADO';

/**
 * Grupo de denúncias contra o mesmo aluno (spec 033). O professor valida o
 * grupo uma vez só: sai uma pontuação do denunciado e ela é dividida entre os
 * autores. Coleção fechada ao cliente; o denunciado nunca sabe do grupo.
 */
export class DenunciaGrupoEntity {
  id: string;
  turmaId: string;
  professorId: string;
  denunciadoAlunoId: string;
  /** Motivo de referência: o tópico da denúncia mais antiga que tiver um. */
  topicoId?: string;
  /** Em ordem cronológica de criação das denúncias. */
  denunciaIds: string[] = [];
  status: StatusGrupo = 'PENDENTE';
  criadoEm: string;
  resolvidoEm?: string;
  pontos?: number;
  /** Total que saiu do denunciado (somado entre os autores). */
  pontosTransferidos?: number;

  constructor(partial: Partial<DenunciaGrupoEntity> = {}) {
    Object.assign(this, partial);
  }

  get pendente(): boolean {
    return this.status === 'PENDENTE';
  }

  static criar(
    denuncias: DenunciaEntity[],
    agora = new Date(),
  ): DenunciaGrupoEntity {
    const unicas = [...new Map(denuncias.map((d) => [d.id, d])).values()];
    if (unicas.length < 2) {
      throw new BadRequestException({
        code: 'GRUPO_MINIMO',
        message: 'Um grupo precisa de pelo menos duas denúncias.',
      });
    }
    const [primeira] = unicas;
    for (const d of unicas) DenunciaGrupoEntity.assertAgrupavel(d, primeira);
    const ordenadas = [...unicas].sort(
      (a, b) =>
        a.criadaEm.localeCompare(b.criadaEm) || a.id.localeCompare(b.id),
    );
    const g = new DenunciaGrupoEntity({
      turmaId: primeira.turmaId,
      professorId: primeira.professorId,
      denunciadoAlunoId: primeira.denunciadoAlunoId,
      denunciaIds: ordenadas.map((d) => d.id),
      status: 'PENDENTE',
      criadoEm: agora.toISOString(),
    });
    const topico = ordenadas.find((d) => d.topicoId)?.topicoId;
    if (topico) g.topicoId = topico;
    return g;
  }

  /**
   * Acrescenta uma denúncia ao grupo. `motivoDiferente` avisa o professor
   * quando o tópico não é o do grupo (texto livre conta como diferente).
   */
  associar(d: DenunciaEntity): { motivoDiferente: boolean } {
    this.assertPendente();
    if (this.denunciaIds.includes(d.id)) {
      throw new BadRequestException({
        code: 'DENUNCIA_EM_GRUPO',
        message: 'Essa denúncia já está neste grupo.',
      });
    }
    DenunciaGrupoEntity.assertAgrupavel(d, {
      turmaId: this.turmaId,
      denunciadoAlunoId: this.denunciadoAlunoId,
    });
    this.denunciaIds.push(d.id);
    return { motivoDiferente: !d.topicoId || d.topicoId !== this.topicoId };
  }

  /** Tira uma denúncia do grupo. Com menos de 2, o grupo se desfaz. */
  desassociar(denunciaId: string): { desfeito: boolean } {
    this.assertPendente();
    if (!this.denunciaIds.includes(denunciaId)) {
      throw new BadRequestException({
        code: 'DENUNCIA_FORA_DO_GRUPO',
        message: 'Essa denúncia não está neste grupo.',
      });
    }
    this.denunciaIds = this.denunciaIds.filter((id) => id !== denunciaId);
    return { desfeito: this.denunciaIds.length < 2 };
  }

  assertPendente(): void {
    if (!this.pendente) {
      throw new ConflictException({
        code: 'GRUPO_RESOLVIDO',
        message: 'Esse grupo já foi resolvido.',
      });
    }
  }

  /** Divide o total entre os autores na ordem dada (mais antigo primeiro). */
  static dividir(
    total: number,
    autoresEmOrdem: string[],
  ): Array<{ alunoId: string; pontos: number }> {
    const partes = dividirIgual(total, autoresEmOrdem.length);
    return autoresEmOrdem.map((alunoId, i) => ({ alunoId, pontos: partes[i] }));
  }

  private static assertAgrupavel(
    d: DenunciaEntity,
    ref: { turmaId: string; denunciadoAlunoId: string },
  ): void {
    if (
      d.turmaId !== ref.turmaId ||
      d.denunciadoAlunoId !== ref.denunciadoAlunoId
    ) {
      throw new BadRequestException({
        code: 'DENUNCIADO_DIFERENTE',
        message: 'Só denúncias contra o mesmo aluno entram no mesmo grupo.',
      });
    }
    if (!d.pendente) {
      throw new BadRequestException({
        code: 'DENUNCIA_RESOLVIDA',
        message: 'Essa denúncia já foi resolvida.',
      });
    }
    if (d.grupoId) {
      throw new BadRequestException({
        code: 'DENUNCIA_EM_GRUPO',
        message: 'Essa denúncia já está em um grupo.',
      });
    }
  }
}
