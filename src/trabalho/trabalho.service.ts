import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AnexoStorage } from '../common/anexo.storage';
import { ProfessorService } from '../professor/professor.service';
import { AlunoRepository } from '../turma/repositories/aluno.repository';
import { TurmaRepository } from '../turma/repositories/turma.repository';
import { XpService } from '../turma/xp.service';
import { AtividadeRepository } from './atividade.repository';
import { AtividadeEntity, DadosAtividade } from './entities/atividade.entity';
import { EntregaRepository } from './entrega.repository';

/** O que o aluno vê da atividade. */
export interface AtividadeView {
  id: string;
  titulo: string;
  descricao: string | null;
  prazo: string;
  valorPontos: number;
  aberta: boolean;
}

/** O professor vê também os contadores da turma. */
export interface AtividadeProfessorView extends AtividadeView {
  totalEntregas: number;
  aguardandoAvaliacao: number;
  totalAlunos: number;
  criadaEm: string;
}

/**
 * Envio de trabalhos (spec 038): o professor cria a atividade, o aluno entrega
 * texto e/ou arquivos até o prazo e o professor avalia; a nota vira XP.
 */
@Injectable()
export class TrabalhoService {
  constructor(
    private readonly atividades: AtividadeRepository,
    private readonly entregas: EntregaRepository,
    private readonly turmaRepo: TurmaRepository,
    private readonly alunoRepo: AlunoRepository,
    private readonly professorService: ProfessorService,
    private readonly xp: XpService,
    private readonly arquivos: AnexoStorage,
  ) {}

  // ===== Professor: atividades (#1–#5) =====

  /** `{ turmaId: n }` de entregas esperando nota (badge da aba). */
  async pendentesPorTurma(
    professorId: string,
  ): Promise<Record<string, number>> {
    const contagem: Record<string, number> = {};
    for (const a of await this.atividades.doProfessor(professorId)) {
      if (!a.aguardandoAvaliacao) continue;
      contagem[a.turmaId] = (contagem[a.turmaId] ?? 0) + a.aguardandoAvaliacao;
    }
    return contagem;
  }

  async listarAtividades(
    professorId: string,
    turmaId: string,
  ): Promise<AtividadeProfessorView[]> {
    await this.turmaDoProfessor(professorId, turmaId);
    const totalAlunos = (await this.alunoRepo.findByTurma(turmaId)).length;
    return (await this.atividades.daTurma(turmaId)).map((a) =>
      this.viewProfessor(a, totalAlunos),
    );
  }

  async criarAtividade(
    professorId: string,
    turmaId: string,
    dados: DadosAtividade,
  ): Promise<AtividadeProfessorView> {
    await this.turmaDoProfessor(professorId, turmaId);
    const nova = AtividadeEntity.criar({ ...dados, turmaId, professorId });
    const criada = await this.atividades.create(nova);
    return this.viewProfessor(criada, await this.totalAlunos(turmaId));
  }

  /** Em transação: uma entrega chegando no meio não perde o contador. */
  async editarAtividade(
    professorId: string,
    turmaId: string,
    id: string,
    dados: DadosAtividade,
  ): Promise<AtividadeProfessorView> {
    await this.turmaDoProfessor(professorId, turmaId);
    const editada = await this.atividades.transacao(async (tx) => {
      const a = await this.atividades.lerNaTransacao(tx, id);
      if (!a || a.turmaId !== turmaId) throw this.atividadeNaoEncontrada();
      a.editar(dados);
      this.atividades.gravarNaTransacao(tx, a);
      return a;
    });
    return this.viewProfessor(editada, await this.totalAlunos(turmaId));
  }

  /** Só sem entregas (#5); relido na transação contra uma entrega simultânea. */
  async excluirAtividade(
    professorId: string,
    turmaId: string,
    id: string,
  ): Promise<void> {
    await this.turmaDoProfessor(professorId, turmaId);
    await this.atividades.transacao(async (tx) => {
      const a = await this.atividades.lerNaTransacao(tx, id);
      if (!a || a.turmaId !== turmaId) throw this.atividadeNaoEncontrada();
      a.garantirExcluivel();
      this.atividades.excluirNaTransacao(tx, id);
    });
  }

  // ===== Views =====

  private view(a: AtividadeEntity, agora = new Date()): AtividadeView {
    return {
      id: a.id,
      titulo: a.titulo,
      descricao: a.descricao ?? null,
      prazo: a.prazo,
      valorPontos: a.valorPontos,
      aberta: a.aberta(agora),
    };
  }

  private viewProfessor(
    a: AtividadeEntity,
    totalAlunos: number,
  ): AtividadeProfessorView {
    return {
      ...this.view(a),
      totalEntregas: a.totalEntregas ?? 0,
      aguardandoAvaliacao: a.aguardandoAvaliacao ?? 0,
      totalAlunos,
      criadaEm: a.criadaEm,
    };
  }

  // ===== Apoio =====

  private atividadeNaoEncontrada(): NotFoundException {
    return new NotFoundException({
      code: 'ATIVIDADE_NAO_ENCONTRADA',
      message: 'Trabalho não encontrado.',
    });
  }

  private async totalAlunos(turmaId: string): Promise<number> {
    return (await this.alunoRepo.findByTurma(turmaId)).length;
  }

  /** Mesmo gate do portal do aluno (recurso GAMIFICACAO, #23). */
  private async assertPlano(professorId: string): Promise<void> {
    const professor = await this.professorService.getProfile(professorId);
    if (!professor.podeGamificar) {
      throw new ForbiddenException({
        code: 'GAMIFICACAO_LOCKED',
        message:
          'O envio de trabalhos faz parte do portal do aluno, exclusivo do plano PhD.',
      });
    }
  }

  private async turmaDoProfessor(professorId: string, turmaId: string) {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma || turma.professorId !== professorId) {
      throw new NotFoundException('Turma não encontrada.');
    }
    await this.assertPlano(professorId);
    return turma;
  }
}
