import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { embaralhar } from '../common/shuffle.util';
import { turmaCasaComJogo } from '../common/vinculo-jogo.util';
import { ProfessorService } from '../professor/professor.service';
import { TurmaRepository } from '../turma/repositories/turma.repository';
import {
  Habitante,
  ISOLATEUS,
  IsolateusMatchEntity,
} from './entities/isolateus-match.entity';
import { VinculoHabitante } from './entities/isolateus-segredo.entity';
import { IsolateusJogoRepository } from './isolateus-jogo.repository';
import { ISOLATEUS_LOCKED } from './isolateus-jogo.service';
import { IsolateusMatchRepository } from './isolateus-match.repository';
import { SETORES, sortearCodinomes } from './isolateus.data';

/**
 * Ciclo de vida da partida até o início: criação, lobby (pseudônimos), veto de
 * nome pelo professor e o **Despertar** — o momento em que a vila é preenchida
 * com NPCs e a Ameaça é sorteada.
 */
@Injectable()
export class IsolateusMatchService {
  constructor(
    private readonly matches: IsolateusMatchRepository,
    private readonly jogos: IsolateusJogoRepository,
    private readonly turmas: TurmaRepository,
    private readonly professores: ProfessorService,
  ) {}

  /** Cria a partida (LOBBY) a partir de uma investigação do professor (PhD). */
  async criar(
    professorId: string,
    jogoId: string,
    turmaId?: string,
  ): Promise<IsolateusMatchEntity> {
    const professor = await this.professores.getProfile(professorId);
    if (!professor.podeGamificar) {
      throw new ForbiddenException(ISOLATEUS_LOCKED);
    }

    const jogo = await this.jogos.findById(jogoId);
    if (!jogo || jogo.professorId !== professorId) {
      throw new NotFoundException('Investigação nao encontrada.');
    }
    if (!jogo.questoes?.length) {
      throw new BadRequestException(
        'Esta investigação não tem questões para defender a vila.',
      );
    }

    const escolhida = await this.resolverTurma(professorId, jogo, turmaId);

    return this.matches.criar(
      {
        jogoId,
        professorId,
        turmaId: escolhida,
        nome: jogo.nome,
        status: 'LOBBY',
        criadaEm: new Date().toISOString(),
        esperanca: ISOLATEUS.ESPERANCA_INICIAL,
        setores: SETORES.map((s) => ({ ...s, intacto: true })),
        habitantes: [],
        rodada: -1,
        totalRodadas: jogo.questoes.length,
        duracaoSegundos: jogo.duracaoSegundos ?? 60,
        faseIniciadaEm: null,
        questaoPublica: null,
        corretaIndex: null,
        alerta: null,
        rumores: [],
        debate: [],
        resumoRodada: null,
        quarentenaRodada: null,
        vereditoQuarentena: null,
        votosRecebidos: 0,
        pulosRecebidos: 0,
        inscritos: [],
        veredito: null,
        rankingFinal: [],
      },
      {
        alienAlunoId: '',
        vinculos: [],
        acaoRodada: null,
        pulosDebate: [],
        pontos: {},
      },
    );
  }

  /** A partida escolhe a turma no início (N:N). Espelha Qlick e Wor. */
  private async resolverTurma(
    professorId: string,
    jogo: { turmas: string[]; disciplina?: string },
    turmaId?: string,
  ): Promise<string | undefined> {
    const turmasDoJogo = jogo.turmas;
    const escolhida =
      turmaId ?? (turmasDoJogo.length === 1 ? turmasDoJogo[0] : undefined);
    if (!escolhida) return undefined;

    const turma = await this.turmas.findById(escolhida);
    if (!turma || turma.professorId !== professorId) {
      throw new NotFoundException('Turma nao encontrada.');
    }
    // Turma atribuída OU (investigação só-disciplina) turma da mesma disciplina.
    if (turmaId && !turmaCasaComJogo(turma, jogo)) {
      throw new BadRequestException({
        code: 'TURMA_NAO_ATRIBUIDA',
        message: 'Esta investigação não está atribuída a essa turma.',
      });
    }
    if (turma.encerradaManualmente) {
      throw new BadRequestException({
        code: 'TURMA_ENCERRADA',
        message: 'Turma encerrada — não é possível iniciar jogos.',
      });
    }
    return escolhida;
  }

  async obterDoProfessor(
    professorId: string,
    partidaId: string,
  ): Promise<IsolateusMatchEntity> {
    const partida = await this.matches.buscar(partidaId);
    if (!partida || partida.professorId !== professorId) {
      throw new NotFoundException('Partida nao encontrada.');
    }
    return partida;
  }

  async obter(partidaId: string): Promise<IsolateusMatchEntity> {
    const partida = await this.matches.buscar(partidaId);
    if (!partida) {
      throw new NotFoundException('Partida nao encontrada.');
    }
    return partida;
  }

  /** Partida ativa da turma do aluno (janela de 12h). */
  async partidaDaTurma(turmaId: string): Promise<IsolateusMatchEntity | null> {
    return this.matches.ativaDaTurma(turmaId);
  }

  /**
   * O Registro. O aluno só declara presença — o codinome dele é sorteado no
   * Despertar. Idempotente: reentrar (recarregar a página, cair a rede) não
   * duplica o inscrito.
   */
  async entrar(
    alunoId: string,
    turmaId: string,
    partidaId: string,
  ): Promise<IsolateusMatchEntity> {
    const partida = await this.obter(partidaId);
    if (partida.turmaId && partida.turmaId !== turmaId) {
      throw new ForbiddenException('Esta partida é de outra turma.');
    }
    if (partida.status !== 'LOBBY') {
      throw new BadRequestException('A investigação já começou.');
    }

    if (partida.inscritos.some((i) => i.alunoId === alunoId)) {
      return partida; // já estava na vila
    }
    const inscritos = [...partida.inscritos, { alunoId }];
    partida.inscritos = inscritos;
    await this.matches.commitPartida(partidaId, { inscritos });
    return partida;
  }

  /**
   * O Comando Central remove um habitante do lobby (entrou na partida errada,
   * saiu da sala). O aluno volta para a tela de entrada e pode reentrar.
   *
   * Só no LOBBY: ao iniciar, `inscritos` é apagado de propósito, e depois do
   * Despertar o professor não sabe mais quem é quem — é assim que tem que ser.
   */
  async removerInscrito(
    professorId: string,
    partidaId: string,
    alunoId: string,
  ): Promise<IsolateusMatchEntity> {
    const partida = await this.obterDoProfessor(professorId, partidaId);
    if (partida.status !== 'LOBBY') {
      throw new BadRequestException('A investigação já começou.');
    }
    const inscritos = partida.inscritos.filter((i) => i.alunoId !== alunoId);
    partida.inscritos = inscritos;
    await this.matches.commitPartida(partidaId, { inscritos });
    return partida;
  }

  /**
   * O Despertar. Preenche a vila com a Névoa de Guerra (NPCs), sorteia a Ameaça
   * entre os habitantes REAIS e some com a lista de inscritos do doc público —
   * ela casaria pseudônimo com `alunoId` e denunciaria quem é NPC.
   */
  async iniciar(
    professorId: string,
    partidaId: string,
  ): Promise<IsolateusMatchEntity> {
    const partida = await this.obterDoProfessor(professorId, partidaId);
    if (partida.status !== 'LOBBY') {
      throw new BadRequestException('A investigação já começou.');
    }
    const reais = partida.inscritos;
    if (reais.length < ISOLATEUS.MIN_REAIS) {
      throw new BadRequestException({
        code: 'POUCOS_INVESTIGADORES',
        message: `A investigação exige no mínimo ${ISOLATEUS.MIN_REAIS} investigadores reais.`,
      });
    }

    // Névoa de Guerra: abaixo de 10 reais, a vila ganha (reais - 1) habitantes
    // virtuais, para que a Ameaça tenha onde se camuflar (§2).
    const qtdNpcs =
      reais.length < ISOLATEUS.LIMIAR_NEVOA ? reais.length - 1 : 0;

    // Um único sorteio para a vila inteira. Reais e NPCs tiram do mesmo saco, na
    // mesma hora: se os codinomes viessem de bancos diferentes (ou em ordens
    // diferentes), a origem do nome viraria pista de quem é virtual.
    const codinomes = sortearCodinomes(reais.length + qtdNpcs);

    const habitantes: Habitante[] = [];
    const vinculos: VinculoHabitante[] = [];

    reais.forEach((inscrito, i) => {
      const id = randomUUID();
      habitantes.push({ id, nome: codinomes[i], vivo: true, preso: false });
      vinculos.push({ habitanteId: id, alunoId: inscrito.alunoId });
    });
    for (let i = 0; i < qtdNpcs; i++) {
      const id = randomUUID();
      habitantes.push({
        id,
        nome: codinomes[reais.length + i],
        vivo: true,
        preso: false,
      });
      vinculos.push({ habitanteId: id }); // sem alunoId = NPC
    }

    // A Ameaça é sempre um habitante real (§2: "todos os NPCs são pacificamente
    // Aldeões"). A ordem dos habitantes também é embaralhada, para que a posição
    // na lista não revele quem entrou no lobby.
    const alienAlunoId = embaralhar(reais)[0].alunoId;

    const dados: Partial<IsolateusMatchEntity> = {
      status: 'TURNO_AMEACA',
      habitantes: embaralhar(habitantes),
      rodada: 0,
      faseIniciadaEm: null,
      inscritos: [], // apaga o vínculo aluno↔pseudônimo da camada pública
    };
    Object.assign(partida, dados);
    await this.matches.commitPartida(partidaId, dados, {
      alienAlunoId,
      vinculos,
      acaoRodada: null,
      pontos: {},
    });
    return partida;
  }
}
