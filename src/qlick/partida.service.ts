import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProfessorService } from '../professor/professor.service';
import { AlunoRepository } from '../turma/repositories/aluno.repository';
import { TurmaRepository } from '../turma/repositories/turma.repository';
import { PartidaEntity } from './entities/partida.entity';
import { PartidaRepository } from './partida.repository';
import { QlickRepository } from './qlick.repository';

@Injectable()
export class PartidaService {
  constructor(
    private readonly partidaRepo: PartidaRepository,
    private readonly qlickRepo: QlickRepository,
    private readonly turmaRepo: TurmaRepository,
    private readonly alunoRepo: AlunoRepository,
    private readonly professorService: ProfessorService,
  ) {}

  /** Cria a partida (LOBBY) a partir de um Qlick do professor (PhD). */
  async criar(professorId: string, qlickId: string): Promise<PartidaEntity> {
    const professor = await this.professorService.getProfile(professorId);
    if (!professor.podeGamificar) {
      throw new ForbiddenException({
        code: 'QLICK_LOCKED',
        message: 'O Tichr Qlick é exclusivo do plano PhD.',
      });
    }
    const qlick = await this.qlickRepo.findById(qlickId);
    if (!qlick || qlick.professorId !== professorId) {
      throw new NotFoundException('Qlick nao encontrado.');
    }
    return this.partidaRepo.create(
      new PartidaEntity({
        qlickId,
        professorId,
        turmaId: qlick.turmaId,
        titulo: qlick.titulo,
        status: 'LOBBY',
        perguntaAtual: -1,
        totalPerguntas: qlick.perguntas.length,
        duracaoSegundos: qlick.duracaoSegundos,
        perguntaIniciadaEm: null,
        perguntaPublica: null,
        corretaIndex: null,
        inscritos: [],
        placar: [],
      }),
    );
  }

  /** Garante que a partida existe e é do professor. */
  async obterDoProfessor(
    professorId: string,
    partidaId: string,
  ): Promise<PartidaEntity> {
    const p = await this.partidaRepo.findById(partidaId);
    if (!p || p.professorId !== professorId) {
      throw new NotFoundException('Partida nao encontrada.');
    }
    return p;
  }

  /** Inscreve o aluno no lobby (idempotente). Só durante o LOBBY. */
  async inscrever(alunoId: string, partidaId: string): Promise<PartidaEntity> {
    const partida = await this.partidaRepo.findById(partidaId);
    if (!partida) {
      throw new NotFoundException('Partida nao encontrada.');
    }
    if (partida.status !== 'LOBBY') {
      throw new BadRequestException('As inscrições já foram encerradas.');
    }
    if (!partida.inscritos.some((i) => i.alunoId === alunoId)) {
      const aluno = await this.alunoRepo.findById(alunoId);
      partida.inscritos = [
        ...partida.inscritos,
        { alunoId, nome: aluno?.nome ?? 'Aluno' },
      ];
      await this.partidaRepo.update(partidaId, {
        inscritos: partida.inscritos,
      });
    }
    return partida;
  }

  /**
   * Partida "de hoje" visível ao aluno: existe uma partida não encerrada da sua
   * turma e o horário atual está dentro da janela da aula (quando há horários).
   */
  async partidaDaTurma(
    turmaId: string,
  ): Promise<{ partidaId: string; titulo: string; status: string } | null> {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma) {
      return null;
    }
    if (!this.dentroDaJanela(turma.horaInicio, turma.horaFim)) {
      return null;
    }
    const partidas = await this.partidaRepo.findByTurma(turmaId);
    const ativa = partidas.filter((p) => p.status !== 'ENCERRADO').at(-1);
    return ativa
      ? { partidaId: ativa.id, titulo: ativa.titulo, status: ativa.status }
      : null;
  }

  /** Verifica se agora está no intervalo [horaInicio, horaFim] (HH:mm). */
  private dentroDaJanela(inicio?: string, fim?: string): boolean {
    if (!inicio || !fim) {
      return true; // sem horários definidos, sempre visível
    }
    const agora = new Date();
    const hhmm = `${String(agora.getHours()).padStart(2, '0')}:${String(
      agora.getMinutes(),
    ).padStart(2, '0')}`;
    return hhmm >= inicio && hhmm <= fim;
  }
}
