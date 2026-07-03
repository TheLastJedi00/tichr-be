import { Injectable } from '@nestjs/common';
import { ProfessorService } from '../professor/professor.service';
import { TurmaRepository } from '../turma/repositories/turma.repository';
import { AlocacaoRepository } from './alocacao.repository';
import { TopicoRepository } from './topico.repository';

export interface TopicoAula {
  numeroAula: number;
  topico: string;
}

@Injectable()
export class AlunoPlanoService {
  constructor(
    private readonly alocacaoRepo: AlocacaoRepository,
    private readonly topicoRepo: TopicoRepository,
    private readonly turmaRepo: TurmaRepository,
    private readonly professorService: ProfessorService,
  ) {}

  /**
   * Tópicos alocados às aulas da turma do aluno (por número). Só quando o
   * professor é PhD — a sincronização com o portal é exclusiva desse plano.
   */
  async topicosDaTurma(turmaId: string): Promise<{ topicos: TopicoAula[] }> {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma) {
      return { topicos: [] };
    }
    const professor = await this.professorService.getProfile(turma.professorId);
    if (!professor.podeGamificar) {
      return { topicos: [] };
    }

    const [alocacoes, topicos] = await Promise.all([
      this.alocacaoRepo.findByTurma(turmaId),
      this.topicoRepo.findByDisciplina(turma.professorId, turma.disciplina ?? ''),
    ]);
    const nomePorId = new Map(topicos.map((t) => [t.id, t.nome]));

    const lista = alocacoes
      .map((a) => ({
        numeroAula: a.numeroAula,
        topico: nomePorId.get(a.topicoId),
      }))
      .filter((x): x is TopicoAula => !!x.topico);

    return { topicos: lista };
  }
}
