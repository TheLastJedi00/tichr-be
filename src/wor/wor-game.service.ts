import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  assertNaoPausada,
  assertPausavel,
  empurrar,
  tempoPausado,
} from '../common/pausa';
import { WorJogoRepository } from './wor-jogo.repository';
import { WorMatchRepository } from './wor-match.repository';
import { MatchView } from './wor-match.service';
import { WOR, WorMatchEntity } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { XpService } from '../turma/xp.service';
import { EfeitoRisco } from './dto/arriscar.dto';
import { CreditoPendente, MotorWor, VotoAcao } from './wor-motor';

export type { VotoAcao } from './wor-motor';

/**
 * Comandos do Tichr Wor. As regras vivem no `MotorWor` (rodada em paralelo,
 * 029); aqui fica o I/O: cada comando roda o motor dentro de uma transação
 * (todos os alunos agem ao mesmo tempo) e, depois do commit, aplica o que não
 * cabe nela — o crédito e a penalidade no ranking da sala. Segredo
 * (palavra/dicas) vem de `wor_jogos` (server-only); o cliente só posta.
 */
@Injectable()
export class WorGameService {
  constructor(
    private readonly jogos: WorJogoRepository,
    private readonly matches: WorMatchRepository,
    private readonly xp: XpService,
  ) {}

  private async carregar(matchId: string): Promise<WorMatchEntity> {
    const match = await this.matches.buscar(matchId);
    if (!match) throw new NotFoundException('Partida não encontrada.');
    return match;
  }

  /**
   * Roda `fn` no motor, numa transação sobre o estado fresco da partida. Com
   * `comando`, pausada responde 409 (028 §4.2) — checado de novo dentro da
   * transação, para uma pausa no meio do caminho não deixar a ação escapar.
   */
  private async executar<R>(
    matchId: string,
    fn: (motor: MotorWor) => R,
    comando = true,
  ): Promise<R> {
    const atual = await this.carregar(matchId);
    if (comando) assertNaoPausada(atual);
    const jogo = await this.jogos.findById(atual.jogoId);
    if (!jogo) throw new NotFoundException('Batalha não encontrada.');

    let credito: CreditoPendente | null = null;
    const resultado = await this.matches.transacao(matchId, (estado) => {
      if (comando) assertNaoPausada(estado.match);
      const motor = new MotorWor(
        estado.match,
        estado.teams,
        estado.rodada,
        jogo,
      );
      const r = fn(motor);
      credito = motor.creditoPendente;
      return { mudancas: motor.mudancas(), resultado: r };
    });
    const pendente = credito as CreditoPendente | null;
    if (pendente) {
      await this.xp.creditarPartida(pendente.turmaId, pendente.creditos, 'WOR');
    }
    return resultado;
  }

  private assertDono(match: WorMatchEntity, professorId: string): void {
    if (match.professorId !== professorId) {
      throw new ForbiddenException('Essa partida não é sua.');
    }
  }

  /**
   * Chuta uma letra e VOTA a ação da equipe (atacar um rival ou comprar dica).
   * A equipe fecha quando todos os membros jogam; a rodada, quando todas fecham.
   */
  async chutarLetra(
    alunoId: string,
    matchId: string,
    letra: string,
    acao: VotoAcao,
    alvoEquipeId?: string,
  ): Promise<MatchView> {
    await this.executar(matchId, (m) =>
      m.chutarLetra(alunoId, letra, acao, alvoEquipeId),
    );
    return this.view(matchId);
  }

  /** Risco Heroico / Invasão: um membro tenta a palavra inteira. */
  async arriscar(
    alunoId: string,
    matchId: string,
    palpite: string,
    opcoes: { efeito?: EfeitoRisco; alvoEquipeId?: string } = {},
  ): Promise<MatchView> {
    await this.executar(matchId, (m) => m.arriscar(alunoId, palpite, opcoes));
    return this.view(matchId);
  }

  /**
   * Linguagem imprópria no chat: o castelo perde HP (no motor) e o aluno perde
   * XP no ranking da sala. Vale com a partida pausada: não é um comando de jogo.
   */
  async penalizarModeracao(matchId: string, alunoId: string): Promise<void> {
    const match = await this.carregar(matchId);
    await this.executar(matchId, (m) => m.penalizarModeracao(alunoId), false);
    if (match.turmaId) {
      await this.xp.penalizarJogo(
        match.turmaId,
        alunoId,
        WOR.PENALIDADE_XP,
        'WOR_MODERACAO',
      );
    }
  }

  /**
   * Fecha a rodada por TEMPO esgotado (cronômetro de 1 min). Disparado pelo
   * projetor do professor; o motor valida o prazo antes de fechar.
   */
  async resolverPorTempo(
    professorId: string,
    matchId: string,
  ): Promise<MatchView> {
    const match = await this.carregar(matchId);
    this.assertDono(match, professorId);
    assertNaoPausada(match);
    await this.executar(matchId, (m) => m.fecharPorTempo());
    return this.view(matchId);
  }

  /** Controle do mestre: pula a palavra atual (avança a onda). Valida posse. */
  async pularPalavra(professorId: string, matchId: string): Promise<MatchView> {
    const match = await this.carregar(matchId);
    this.assertDono(match, professorId);
    assertNaoPausada(match);
    await this.executar(matchId, (m) => m.pularPalavra());
    return this.view(matchId);
  }

  // ===== Pausa (028 §4) =====

  /** O mestre pausa a batalha em andamento. Pausar de novo não muda nada. */
  async pausar(professorId: string, matchId: string): Promise<MatchView> {
    const match = await this.carregar(matchId);
    this.assertDono(match, professorId);
    assertPausavel(match.status);
    if (!match.pausadaEm) {
      await this.matches.atualizar(matchId, {
        pausadaEm: new Date(Date.now()).toISOString(),
      });
    }
    return this.view(matchId);
  }

  /**
   * Retoma: o relógio da rodada é empurrado pelo tempo pausado, e o Action
   * Card que estava em cartaz também (na raiz e nas equipes) — senão ele
   * sumiria no meio, já que o cliente o tira de cena por `em + duracaoMs`.
   */
  async retomar(professorId: string, matchId: string): Promise<MatchView> {
    const match = await this.carregar(matchId);
    this.assertDono(match, professorId);
    if (!match.pausadaEm) return this.view(matchId);

    const pausa = tempoPausado(match.pausadaEm);
    const raiz: Partial<WorMatchEntity> = {
      pausadaEm: null,
      rodadaIniciadaEm: empurrar(match.rodadaIniciadaEm, pausa),
    };
    const card = match.lastGlobalAction;
    const patches: Record<string, Partial<WorTeamEntity>> = {};
    if (
      card &&
      Date.parse(card.em) + card.duracaoMs > Date.parse(match.pausadaEm)
    ) {
      const emCartaz = { ...card, em: empurrar(card.em, pausa) };
      raiz.lastGlobalAction = emCartaz;
      for (const t of await this.matches.listarTeams(matchId)) {
        patches[t.id] = { lastGlobalAction: emCartaz };
      }
    }
    await this.matches.commitPartida(matchId, raiz, patches);
    return this.view(matchId);
  }

  private async view(matchId: string): Promise<MatchView> {
    const match = await this.matches.buscar(matchId);
    const teams = await this.matches.listarTeams(matchId);
    return { match: match!, teams };
  }
}
