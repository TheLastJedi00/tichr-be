import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hojeISO } from '../common/date.util';
import { ProfessorService } from '../professor/professor.service';
import { AlunoRepository } from './repositories/aluno.repository';
import { TurmaRepository } from './repositories/turma.repository';

@Injectable()
export class PortalService {
  constructor(
    private readonly professorService: ProfessorService,
    private readonly turmaRepo: TurmaRepository,
    private readonly alunoRepo: AlunoRepository,
  ) {}

  /**
   * Dados do professor (com avatar) + suas turmas **ativas** para a busca do
   * aluno. O avatar da a ancora visual do card de resultado no portal.
   */
  async turmasAtivas(username: string): Promise<{
    professor: { nome: string; username: string; avatarUrl?: string };
    turmas: Array<{
      turmaId: string;
      nome: string;
      cor?: string;
      pinLength: number;
    }>;
  }> {
    const professor = await this.professorService.findByUsername(username);
    if (!professor) {
      throw new NotFoundException('Professor nao encontrado.');
    }
    const hoje = hojeISO();
    const turmas = await this.turmaRepo.findByProfessor(professor.uid);
    return {
      professor: {
        nome: professor.nomeExibicao ?? professor.username ?? username,
        username: professor.username ?? username,
        avatarUrl: professor.avatarUrl,
      },
      turmas: turmas
        .filter((t) => t.contaComoAtiva(hoje))
        // `pinLength` diz ao portal quantos slots de PIN exibir (2 Smart / 6 legado).
        .map((t) => ({
          turmaId: t.id,
          nome: t.nome,
          cor: t.cor,
          pinLength: t.pinTurma?.length ?? 6,
        })),
    };
  }

  /**
   * Valida o PIN de 6 dígitos da turma e só então devolve os nomes dos alunos
   * (isolamento entre turmas) + a config pública de pontuação.
   */
  async desbloquear(turmaId: string, pinTurma: string) {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma) {
      throw new NotFoundException('Turma nao encontrada.');
    }
    if (turma.pinTurma !== pinTurma) {
      throw new UnauthorizedException('PIN da turma invalido.');
    }
    const alunos = await this.alunoRepo.findByTurma(turmaId);
    const cfg = turma.configPontuacao;
    // Quantos slots o portal exibe no PIN do aluno (2 Smart / 4 legado).
    const pinAlunoLength =
      alunos.find((a) => a.pinAcesso)?.pinAcesso?.length ?? 4;
    return {
      turmaId,
      turmaNome: turma.nome,
      alunos: alunos.map((a) => ({ id: a.id, nome: a.nome })),
      config: { nomePontuacao: cfg.nomePontuacao, rankingAtivo: cfg.rankingAtivo },
      pinAlunoLength,
    };
  }
}
