import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { ProfessorService } from '../professor/professor.service';
import { AlunoRepository } from '../turma/repositories/aluno.repository';
import { TurmaRepository } from '../turma/repositories/turma.repository';
import { XpService } from '../turma/xp.service';
import { PartidaEntity, PlacarItem } from './entities/partida.entity';
import { PartidaRepository } from './partida.repository';
import { QlickRepository } from './qlick.repository';

/** Pontos por acerto + bônus máximo de rapidez. */
const PONTOS_ACERTO = 1000;
const BONUS_RAPIDEZ = 500;

/** Por quanto tempo após a criação a partida continua "de hoje" para o aluno. */
const JANELA_VISIBILIDADE_MS = 12 * 60 * 60 * 1000; // 12h

@Injectable()
export class PartidaService {
  constructor(
    private readonly partidaRepo: PartidaRepository,
    private readonly qlickRepo: QlickRepository,
    private readonly turmaRepo: TurmaRepository,
    private readonly alunoRepo: AlunoRepository,
    private readonly professorService: ProfessorService,
    private readonly firebase: FirebaseService,
    private readonly xpService: XpService,
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
    if (qlick.turmaId) {
      const turma = await this.turmaRepo.findById(qlick.turmaId);
      if (turma?.encerradaManualmente) {
        throw new BadRequestException({
          code: 'TURMA_ENCERRADA',
          message: 'Turma encerrada — não é possível iniciar jogos.',
        });
      }
    }
    return this.partidaRepo.create(
      new PartidaEntity({
        qlickId,
        professorId,
        turmaId: qlick.turmaId,
        titulo: qlick.titulo,
        status: 'LOBBY',
        criadaEm: new Date().toISOString(),
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
   * Partida "de hoje" visível ao aluno: a partida **não encerrada** mais recente
   * da sua turma, desde que criada há pouco (janela de visibilidade). O gatilho
   * é o professor ter rodado a partida — não depende do relógio, então não sofre
   * com fuso do servidor. `criadaEm` evita ressuscitar sessões abandonadas.
   */
  async partidaDaTurma(
    turmaId: string,
  ): Promise<{ partidaId: string; titulo: string; status: string } | null> {
    const limite = Date.now() - JANELA_VISIBILIDADE_MS;
    const partidas = await this.partidaRepo.findByTurma(turmaId);
    const ativa = partidas
      .filter((p) => p.status !== 'ENCERRADO')
      .filter((p) => !p.criadaEm || Date.parse(p.criadaEm) >= limite)
      .sort((a, b) => (a.criadaEm ?? '').localeCompare(b.criadaEm ?? ''))
      .at(-1);
    return ativa
      ? { partidaId: ativa.id, titulo: ativa.titulo, status: ativa.status }
      : null;
  }

  // ===== Fluxo da partida (CQRS) =====

  /** Professor: congela inscritos e ativa a pergunta 1. */
  async iniciar(professorId: string, partidaId: string): Promise<PartidaEntity> {
    const partida = await this.obterDoProfessor(professorId, partidaId);
    if (partida.status !== 'LOBBY') {
      throw new BadRequestException('A partida já começou.');
    }
    if (partida.inscritos.length === 0) {
      throw new BadRequestException('Nenhum aluno inscrito.');
    }
    return this.ativarPergunta(partida, 0);
  }

  /** Professor: revela o resultado da rodada (timer esgotado). */
  async apurarComando(
    professorId: string,
    partidaId: string,
  ): Promise<PartidaEntity> {
    const partida = await this.obterDoProfessor(professorId, partidaId);
    if (partida.status !== 'QUESTAO_ATIVA') {
      throw new BadRequestException('Não há pergunta ativa.');
    }
    return this.apurar(partida);
  }

  /** Professor: avança para a próxima pergunta. */
  async proxima(professorId: string, partidaId: string): Promise<PartidaEntity> {
    const partida = await this.obterDoProfessor(professorId, partidaId);
    if (partida.status !== 'RANKING_PARCIAL') {
      throw new BadRequestException('Aguarde a apuração da rodada.');
    }
    const proximo = partida.perguntaAtual + 1;
    if (proximo >= partida.totalPerguntas) {
      throw new BadRequestException('Foi a última pergunta. Encerre a partida.');
    }
    return this.ativarPergunta(partida, proximo);
  }

  /** Professor: encerra e monta o ranking final. */
  async encerrar(
    professorId: string,
    partidaId: string,
  ): Promise<PartidaEntity> {
    const partida = await this.obterDoProfessor(professorId, partidaId);
    if (partida.status === 'ENCERRADO') {
      throw new BadRequestException('A partida já foi encerrada.');
    }
    const rankingFinal = [...partida.placar]
      .sort((a, b) => b.pontos - a.pontos)
      .map((p, i) => ({ posicao: i + 1, ...p }));
    const dados: Partial<PartidaEntity> = {
      status: 'ENCERRADO',
      rankingFinal,
      perguntaPublica: null,
      corretaIndex: null,
    };
    Object.assign(partida, dados);
    await this.partidaRepo.update(partidaId, dados);

    // Converte os pontos da partida em XP do portal (só faz sentido com turma).
    if (partida.turmaId) {
      await this.xpService.creditarPartida(
        partida.turmaId,
        partida.placar.map((p) => ({ alunoId: p.alunoId, pontos: p.pontos })),
      );
    }
    return partida;
  }

  /** Aluno: submete a resposta da pergunta corrente. */
  async responder(
    alunoId: string,
    partidaId: string,
    alternativaIndex: number,
  ): Promise<{ registrada: boolean }> {
    const partida = await this.partidaRepo.findById(partidaId);
    if (!partida) {
      throw new NotFoundException('Partida nao encontrada.');
    }
    if (partida.status !== 'QUESTAO_ATIVA') {
      throw new BadRequestException('Não há pergunta ativa.');
    }
    if (!partida.inscritos.some((i) => i.alunoId === alunoId)) {
      throw new ForbiddenException('Você não está inscrito nesta partida.');
    }

    const idx = partida.perguntaAtual;
    const docId = `${partidaId}_${idx}_${alunoId}`;
    const ref = this.firebase.firestore.collection('qlick_respostas').doc(docId);
    if ((await ref.get()).exists) {
      return { registrada: false }; // já respondeu esta pergunta
    }

    const qlick = await this.qlickRepo.findById(partida.qlickId);
    const pergunta = qlick?.perguntas[idx];
    const correta = !!pergunta && alternativaIndex === pergunta.corretaIndex;
    const tempoMs = partida.perguntaIniciadaEm
      ? Date.now() - Date.parse(partida.perguntaIniciadaEm)
      : 0;
    const pontos = this.computarPontos(correta, tempoMs, partida.duracaoSegundos);

    await ref.set({
      partidaId,
      perguntaIndex: idx,
      alunoId,
      alternativaIndex,
      correta,
      pontos,
    });

    // Apuração automática quando todos os inscritos já responderam.
    const respondidos = await this.contarRespostas(partidaId, idx);
    if (respondidos >= partida.inscritos.length) {
      await this.apurar(partida);
    }
    return { registrada: true };
  }

  // ===== helpers do fluxo =====

  private async ativarPergunta(
    partida: PartidaEntity,
    idx: number,
  ): Promise<PartidaEntity> {
    const qlick = await this.qlickRepo.findById(partida.qlickId);
    const pergunta = qlick!.perguntas[idx];
    const dados: Partial<PartidaEntity> = {
      status: 'QUESTAO_ATIVA',
      perguntaAtual: idx,
      perguntaIniciadaEm: new Date().toISOString(),
      perguntaPublica: {
        enunciado: pergunta.enunciado,
        alternativas: pergunta.alternativas,
      },
      corretaIndex: null,
      rankingParcial: [],
    };
    Object.assign(partida, dados);
    await this.partidaRepo.update(partida.id, dados);
    return partida;
  }

  private async apurar(partida: PartidaEntity): Promise<PartidaEntity> {
    const idx = partida.perguntaAtual;
    const qlick = await this.qlickRepo.findById(partida.qlickId);
    const pergunta = qlick!.perguntas[idx];
    const respostas = await this.lerRespostas(partida.id, idx);

    const nomePorId = new Map(partida.inscritos.map((i) => [i.alunoId, i.nome]));
    const placarMap = new Map<string, PlacarItem>(
      partida.placar.map((p) => [p.alunoId, { ...p }]),
    );
    const rodada: PlacarItem[] = [];
    for (const r of respostas) {
      const nome = nomePorId.get(r.alunoId) ?? 'Aluno';
      const acumulado = placarMap.get(r.alunoId) ?? {
        alunoId: r.alunoId,
        nome,
        pontos: 0,
      };
      acumulado.pontos += r.pontos;
      placarMap.set(r.alunoId, acumulado);
      rodada.push({ alunoId: r.alunoId, nome, pontos: r.pontos });
    }

    const placar = [...placarMap.values()].sort((a, b) => b.pontos - a.pontos);
    const rankingParcial = rodada
      .sort((a, b) => b.pontos - a.pontos)
      .slice(0, 3);
    const dados: Partial<PartidaEntity> = {
      status: 'RANKING_PARCIAL',
      corretaIndex: pergunta.corretaIndex,
      placar,
      rankingParcial,
    };
    Object.assign(partida, dados);
    await this.partidaRepo.update(partida.id, dados);
    return partida;
  }

  private computarPontos(
    correta: boolean,
    tempoMs: number,
    duracaoSegundos: number,
  ): number {
    if (!correta) {
      return 0;
    }
    const janela = duracaoSegundos * 1000;
    const fracao = Math.max(0, 1 - tempoMs / janela);
    return PONTOS_ACERTO + Math.round(fracao * BONUS_RAPIDEZ);
  }

  /** Lê as respostas de uma pergunta (query só por partidaId; filtra idx em memória). */
  private async lerRespostas(
    partidaId: string,
    idx: number,
  ): Promise<Array<{ alunoId: string; pontos: number }>> {
    const snap = await this.firebase.firestore
      .collection('qlick_respostas')
      .where('partidaId', '==', partidaId)
      .get();
    return snap.docs
      .map((d) => d.data())
      .filter((r) => r.perguntaIndex === idx)
      .map((r) => ({ alunoId: r.alunoId as string, pontos: r.pontos as number }));
  }

  private async contarRespostas(
    partidaId: string,
    idx: number,
  ): Promise<number> {
    return (await this.lerRespostas(partidaId, idx)).length;
  }
}
