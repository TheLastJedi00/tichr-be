import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProfessorService } from '../professor/professor.service';
import { AlunoRepository } from '../turma/repositories/aluno.repository';
import { TurmaRepository } from '../turma/repositories/turma.repository';
import { PerguntaMensagemRepository } from './pergunta-mensagem.repository';
import { PerguntaRepository } from './pergunta.repository';

export interface EstadoJanelaPerguntas {
  abertas: boolean;
  desde: string | null;
}

/**
 * Perguntas do aluno ao professor (spec 037): conversa privada entre o aluno
 * autor e o professor dono da turma, com anexo opcional do aluno.
 */
@Injectable()
export class PerguntaService {
  constructor(
    private readonly perguntas: PerguntaRepository,
    private readonly mensagens: PerguntaMensagemRepository,
    private readonly turmaRepo: TurmaRepository,
    private readonly alunoRepo: AlunoRepository,
    private readonly professorService: ProfessorService,
  ) {}

  // ===== Janela de perguntas (#1–#3) =====

  async estadoJanela(
    professorId: string,
    turmaId: string,
  ): Promise<EstadoJanelaPerguntas> {
    const turma = await this.turmaDoProfessor(professorId, turmaId);
    return this.estado(turma);
  }

  /** Abrir já aberta mantém o "desde" original. */
  async abrirJanela(
    professorId: string,
    turmaId: string,
  ): Promise<EstadoJanelaPerguntas> {
    const turma = await this.turmaDoProfessor(professorId, turmaId);
    if (turma.perguntasAbertas === true) return this.estado(turma);
    const desde = new Date().toISOString();
    await this.turmaRepo.update(turmaId, {
      perguntasAbertas: true,
      perguntasAbertasDesde: desde,
    });
    return { abertas: true, desde };
  }

  /** Fechar não mexe nas perguntas: o professor segue respondendo (#3). */
  async fecharJanela(
    professorId: string,
    turmaId: string,
  ): Promise<EstadoJanelaPerguntas> {
    const turma = await this.turmaDoProfessor(professorId, turmaId);
    if (turma.perguntasAbertas === true) {
      await this.turmaRepo.update(turmaId, {
        perguntasAbertas: false,
        perguntasAbertasDesde: null,
      });
    }
    return { abertas: false, desde: null };
  }

  // ===== Apoio =====

  private estado(turma: {
    perguntasAbertas?: boolean;
    perguntasAbertasDesde?: string | null;
  }): EstadoJanelaPerguntas {
    const abertas = turma.perguntasAbertas === true;
    return {
      abertas,
      desde: abertas ? (turma.perguntasAbertasDesde ?? null) : null,
    };
  }

  /** Mesmo gate do portal do aluno (recurso GAMIFICACAO, #17). */
  private async assertPlano(professorId: string): Promise<void> {
    const professor = await this.professorService.getProfile(professorId);
    if (!professor.podeGamificar) {
      throw new ForbiddenException({
        code: 'GAMIFICACAO_LOCKED',
        message:
          'As perguntas fazem parte do portal do aluno, exclusivo do plano PhD.',
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
