import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { embaralhar } from '../common/shuffle.util';
import { turmaCasaComJogo } from '../common/vinculo-jogo.util';
import { ProfessorService } from '../professor/professor.service';
import { TurmaRepository } from '../turma/repositories/turma.repository';
import { WorJogoRepository } from './wor-jogo.repository';
import { WorMatchRepository } from './wor-match.repository';
import { WorMatchEntity } from './entities/wor-match.entity';
import { CORES_TEAM, WorTeamEntity } from './entities/wor-team.entity';
import { WOR, tamanhoEquipe } from './entities/wor-match.entity';

export interface MatchView {
  match: WorMatchEntity;
  teams: WorTeamEntity[];
}

/** Orquestra a criação/lobby de partidas do Tichr Wor (estado fragmentado). */
@Injectable()
export class WorMatchService {
  constructor(
    private readonly jogos: WorJogoRepository,
    private readonly matches: WorMatchRepository,
    private readonly professorService: ProfessorService,
    private readonly turmaRepo: TurmaRepository,
  ) {}

  private async assertProfessor(
    matchId: string,
    professorId: string,
  ): Promise<WorMatchEntity> {
    const match = await this.matches.buscar(matchId);
    if (!match) throw new NotFoundException('Partida não encontrada.');
    if (match.professorId !== professorId) {
      throw new ForbiddenException('Essa partida não é sua.');
    }
    return match;
  }

  /**
   * Cria a partida (lobby) montando a onda 1 da palavra secreta. A turma é
   * derivada do vínculo da batalha, como no Qlick: sem escolha explícita, cai na
   * única turma atribuída; com várias, o professor informa qual rodar. Exige PhD.
   */
  async criar(
    professorId: string,
    jogoId: string,
    turmaId?: string,
  ): Promise<WorMatchEntity> {
    const professor = await this.professorService.getProfile(professorId);
    if (!professor.podeGamificar) {
      throw new ForbiddenException({
        code: 'WOR_LOCKED',
        message: 'O Tichr Wor é exclusivo do plano PhD.',
      });
    }
    const jogo = await this.jogos.findById(jogoId);
    if (!jogo) throw new NotFoundException('Batalha não encontrada.');
    if (jogo.professorId !== professorId) {
      throw new ForbiddenException('Essa batalha não é sua.');
    }
    if (!jogo.palavras?.length) {
      throw new BadRequestException('Adicione ao menos uma palavra ao arsenal.');
    }

    const escolhida = await this.resolverTurma(professorId, jogo, turmaId);

    const primeira = jogo.palavras[0];
    return this.matches.criar({
      jogoId,
      professorId,
      turmaId: escolhida,
      nome: jogo.nome,
      status: 'LOBBY',
      criadaEm: new Date().toISOString(),
      ondaIndex: 0,
      totalOndas: jogo.palavras.length,
      mascara: WorMatchEntity.mascarar(primeira.palavra, new Set()),
      letrasTentadas: [],
      cartasVisiveis: primeira.dicas.slice(0, 1),
      totalCartas: primeira.dicas.length,
      turnoEquipeId: null,
      ordemEquipes: [],
      acoesRodada: [],
      placar: [],
      inscritos: [],
      vencedorEquipeId: null,
    });
  }

  /**
   * Escolhe a turma da partida (N:N): a informada, ou — na ausência — a única
   * turma atribuída à batalha. Valida que a turma pertence à batalha, é do
   * professor e não está encerrada. Espelha o `PartidaService.criar` do Qlick.
   */
  private async resolverTurma(
    professorId: string,
    jogo: { turmas: string[]; disciplina?: string },
    turmaId?: string,
  ): Promise<string | undefined> {
    const turmasDoJogo = jogo.turmas;
    const escolhida =
      turmaId ?? (turmasDoJogo.length === 1 ? turmasDoJogo[0] : undefined);
    if (escolhida) {
      const turma = await this.turmaRepo.findById(escolhida);
      if (!turma || turma.professorId !== professorId) {
        throw new NotFoundException('Turma não encontrada.');
      }
      // Turma atribuída OU (batalha só-disciplina) turma da mesma disciplina.
      if (turmaId && !turmaCasaComJogo(turma, jogo)) {
        throw new BadRequestException({
          code: 'TURMA_NAO_ATRIBUIDA',
          message: 'Esta batalha não está atribuída a essa turma.',
        });
      }
      if (turma.encerradaManualmente) {
        throw new BadRequestException({
          code: 'TURMA_ENCERRADA',
          message: 'Turma encerrada — não é possível iniciar jogos.',
        });
      }
    }
    return escolhida;
  }

  /** Visão pública para a turma (aluno/projetor): raiz + equipes. */
  async partidaDaTurma(turmaId: string): Promise<MatchView | null> {
    const match = await this.matches.ativaDaTurma(turmaId);
    if (!match) return null;
    const teams = await this.matches.listarTeams(match.id);
    return { match, teams };
  }

  async view(matchId: string): Promise<MatchView> {
    const match = await this.matches.buscar(matchId);
    if (!match) throw new NotFoundException('Partida não encontrada.');
    const teams = await this.matches.listarTeams(matchId);
    return { match, teams };
  }

  /** Inscrição do aluno no lobby. */
  async inscrever(
    alunoId: string,
    turmaId: string,
    matchId: string,
    nome: string,
  ): Promise<MatchView> {
    const match = await this.matches.buscar(matchId);
    if (!match) throw new NotFoundException('Partida não encontrada.');
    if (match.turmaId !== turmaId) {
      throw new ForbiddenException('Essa partida não é da sua turma.');
    }
    if (match.status !== 'LOBBY') {
      throw new BadRequestException('A partida já começou.');
    }
    if (!match.inscritos.some((i) => i.alunoId === alunoId)) {
      const inscritos = [...match.inscritos, { alunoId, nome }];
      await this.matches.atualizar(matchId, { inscritos });
    }
    return this.view(matchId);
  }

  /**
   * Distribui os inscritos em equipes com **tamanho automático** pelo nº de
   * alunos na sala: duplas a partir de 4, trios a partir de 6, quartetos a
   * partir de 8 (máx. 4 por equipe). O professor só clica "Distribuir".
   */
  async distribuir(
    professorId: string,
    matchId: string,
  ): Promise<MatchView> {
    const match = await this.assertProfessor(matchId, professorId);
    if (match.status !== 'LOBBY') {
      throw new BadRequestException('A partida já começou.');
    }
    const total = match.inscritos.length;
    if (total < 2) {
      throw new BadRequestException('São necessários pelo menos 2 alunos na sala.');
    }

    const tamanho = tamanhoEquipe(total);
    const numeroEquipes = Math.min(
      Math.ceil(total / tamanho),
      CORES_TEAM.length,
    );

    const membrosPorEquipe: Array<typeof match.inscritos> = Array.from(
      { length: numeroEquipes },
      () => [],
    );
    embaralhar(match.inscritos).forEach((aluno, i) => {
      membrosPorEquipe[i % numeroEquipes].push(aluno);
    });

    const ordemEquipes: string[] = [];
    for (let i = 0; i < numeroEquipes; i++) {
      const teamId = `equipe-${i + 1}`;
      ordemEquipes.push(teamId);
      await this.matches.criarTeam(matchId, teamId, {
        matchId,
        nome: `Equipe ${i + 1}`,
        cor: CORES_TEAM[i],
        hp: WOR.HP_INICIAL,
        isHorde: false,
        pontos: 0,
        membros: membrosPorEquipe[i],
      });
    }
    const placar = ordemEquipes.map((id, i) => ({
      id,
      nome: `Equipe ${i + 1}`,
      cor: CORES_TEAM[i],
      hp: WOR.HP_INICIAL,
      isHorde: false,
      pontos: 0,
    }));
    await this.matches.atualizar(matchId, { ordemEquipes, placar });
    return this.view(matchId);
  }

  /** Inicia a batalha: passa para EM_ANDAMENTO e define o primeiro turno. */
  async iniciar(professorId: string, matchId: string): Promise<MatchView> {
    const match = await this.assertProfessor(matchId, professorId);
    const teams = await this.matches.listarTeams(matchId);
    if (teams.length < 2) {
      throw new BadRequestException('Distribua as equipes antes de iniciar.');
    }
    await this.matches.atualizar(matchId, {
      status: 'EM_ANDAMENTO',
      turnoEquipeId: match.ordemEquipes[0],
      rodadaIniciadaEm: new Date().toISOString(),
    });
    return this.view(matchId);
  }
}
