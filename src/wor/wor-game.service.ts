import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorJogoRepository } from './wor-jogo.repository';
import { WorMatchRepository } from './wor-match.repository';
import { MatchView } from './wor-match.service';
import { WOR, WorMatchEntity } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { PalavraWor } from './entities/wor-jogo.entity';

export type AcaoDilema = 'ATACAR' | 'COMPRAR_DICA';

/**
 * Motor de turnos do Tichr Wor: chutar letra, Dilema Tático, Risco Heroico e
 * avanço de onda. Todas as regras/dano ficam aqui e nas entidades; o cliente só
 * dispara POSTs. Segredo (palavra/dicas) vem de `wor_jogos` (server-only).
 */
@Injectable()
export class WorGameService {
  constructor(
    private readonly jogos: WorJogoRepository,
    private readonly matches: WorMatchRepository,
  ) {}

  private async carregar(matchId: string) {
    const match = await this.matches.buscar(matchId);
    if (!match) throw new NotFoundException('Partida não encontrada.');
    return match;
  }

  private async palavraDaOnda(match: WorMatchEntity): Promise<PalavraWor> {
    const jogo = await this.jogos.findById(match.jogoId);
    if (!jogo) throw new NotFoundException('Batalha não encontrada.');
    return jogo.palavras[match.ondaIndex];
  }

  private async equipeDoAluno(
    matchId: string,
    alunoId: string,
  ): Promise<{ team: WorTeamEntity; teams: WorTeamEntity[] }> {
    const teams = await this.matches.listarTeams(matchId);
    const team = teams.find((t) =>
      t.membros.some((m) => m.alunoId === alunoId),
    );
    if (!team) throw new ForbiddenException('Você não está em nenhuma equipe.');
    return { team, teams };
  }

  /** Próximo time na ordem (round-robin). Hordes também têm turno (só arriscam). */
  private proximoTurno(match: WorMatchEntity): string {
    const ordem = match.ordemEquipes;
    const i = ordem.indexOf(match.turnoEquipeId ?? '');
    return ordem[(i + 1) % ordem.length];
  }

  /** Letras já tentadas que EXISTEM na palavra (para montar a máscara). */
  private reveladas(palavra: string, tentadas: string[]): Set<string> {
    const naPalavra = new Set(
      [...palavra].map((c) => WorMatchEntity.normalizar(c)),
    );
    return new Set(tentadas.filter((l) => naPalavra.has(l)));
  }

  private assertEmAndamento(match: WorMatchEntity): void {
    if (match.status !== 'EM_ANDAMENTO') {
      throw new BadRequestException('A partida não está em andamento.');
    }
  }

  private assertTurno(match: WorMatchEntity, team: WorTeamEntity): void {
    if (match.turnoEquipeId !== team.id) {
      throw new BadRequestException({
        code: 'FORA_DO_TURNO',
        message: 'Não é o turno da sua equipe.',
      });
    }
  }

  /** Chuta uma letra. Erro = Dano do Sistema + passa turno; acerto = revela + Dilema. */
  async chutarLetra(
    alunoId: string,
    matchId: string,
    letraRaw: string,
  ): Promise<MatchView> {
    const match = await this.carregar(matchId);
    this.assertEmAndamento(match);
    if (match.aguardandoDilema) {
      throw new BadRequestException('Resolva o Dilema Tático primeiro.');
    }
    const { team } = await this.equipeDoAluno(matchId, alunoId);
    if (team.isHorde) {
      throw new BadRequestException('A Horda só pode tentar a Invasão (arriscar a palavra).');
    }
    this.assertTurno(match, team);

    const letra = WorMatchEntity.normalizar(letraRaw);
    if (!/^[A-Z]$/.test(letra)) {
      throw new BadRequestException('Envie uma única letra.');
    }
    if (match.letrasTentadas.includes(letra)) {
      throw new BadRequestException('Essa letra já foi tentada.');
    }

    const { palavra } = await this.palavraDaOnda(match);
    const letrasTentadas = [...match.letrasTentadas, letra];
    const acertou = this.reveladas(palavra, [letra]).size > 0;

    if (!acertou) {
      // Erro: Dano do Sistema no próprio castelo + passa o turno.
      team.aplicarDano(WOR.DANO_SISTEMA);
      await this.matches.atualizarTeam(matchId, team.id, {
        hp: team.hp,
        isHorde: team.isHorde,
      });
      await this.matches.atualizar(matchId, {
        letrasTentadas,
        turnoEquipeId: this.proximoTurno(match),
      });
      return this.view(matchId);
    }

    // Acerto: revela ocorrências. Se completou a palavra, encerra a onda.
    const mascara = WorMatchEntity.mascarar(
      palavra,
      this.reveladas(palavra, letrasTentadas),
    );
    if (WorMatchEntity.estaCompleta(mascara)) {
      await this.matches.atualizar(matchId, { letrasTentadas, mascara });
      await this.avancarOnda(matchId);
      return this.view(matchId);
    }
    // Senão, abre o Dilema Tático para a equipe.
    await this.matches.atualizar(matchId, {
      letrasTentadas,
      mascara,
      aguardandoDilema: true,
      dilemaEquipeId: team.id,
    });
    return this.view(matchId);
  }

  /** Resolve o Dilema Tático: Atacar um rival OU Comprar (revelar) uma Dica. */
  async resolverDilema(
    alunoId: string,
    matchId: string,
    acao: AcaoDilema,
    alvoEquipeId?: string,
  ): Promise<MatchView> {
    const match = await this.carregar(matchId);
    this.assertEmAndamento(match);
    if (!match.aguardandoDilema) {
      throw new BadRequestException('Não há Dilema Tático pendente.');
    }
    const { team } = await this.equipeDoAluno(matchId, alunoId);
    if (match.dilemaEquipeId !== team.id) {
      throw new ForbiddenException('O Dilema é de outra equipe.');
    }

    if (acao === 'ATACAR') {
      if (!alvoEquipeId || alvoEquipeId === team.id) {
        throw new BadRequestException('Escolha um castelo rival para atacar.');
      }
      const alvo = await this.matches.buscarTeam(matchId, alvoEquipeId);
      if (!alvo) throw new NotFoundException('Equipe alvo não encontrada.');
      alvo.aplicarDano(WOR.DANO_ATAQUE);
      await this.matches.atualizarTeam(matchId, alvo.id, {
        hp: alvo.hp,
        isHorde: alvo.isHorde,
      });
    } else {
      // COMPRAR_DICA: revela a próxima carta (sacrifício do ataque).
      const { dicas } = await this.palavraDaOnda(match);
      if (match.cartasVisiveis.length >= dicas.length) {
        throw new BadRequestException('Todas as cartas já foram reveladas.');
      }
      await this.matches.atualizar(matchId, {
        cartasVisiveis: dicas.slice(0, match.cartasVisiveis.length + 1),
      });
    }

    // Encerra o dilema e passa o turno.
    await this.matches.atualizar(matchId, {
      aguardandoDilema: false,
      dilemaEquipeId: null,
      turnoEquipeId: this.proximoTurno(match),
    });
    return this.view(matchId);
  }

  /**
   * Risco Heroico / Invasão: tenta a palavra inteira. Acerto (castelo vivo) =
   * Cura Massiva + encerra a onda; erro = Dano Crítico + passa o turno.
   * (A Usurpação da Horda entra na Fase 5.)
   */
  async arriscar(
    alunoId: string,
    matchId: string,
    palpite: string,
  ): Promise<MatchView> {
    const match = await this.carregar(matchId);
    this.assertEmAndamento(match);
    if (match.aguardandoDilema) {
      throw new BadRequestException('Resolva o Dilema Tático primeiro.');
    }
    const { team } = await this.equipeDoAluno(matchId, alunoId);
    this.assertTurno(match, team);

    const { palavra } = await this.palavraDaOnda(match);
    const acertou =
      WorMatchEntity.normalizar(palpite.trim()) ===
      WorMatchEntity.normalizar(palavra.trim());

    if (acertou) {
      team.curar(WOR.CURA_MASSIVA);
      await this.matches.atualizarTeam(matchId, team.id, { hp: team.hp });
      await this.avancarOnda(matchId);
      return this.view(matchId);
    }

    // Desastre: Dano Crítico + passa o turno.
    team.aplicarDano(WOR.DANO_CRITICO);
    await this.matches.atualizarTeam(matchId, team.id, {
      hp: team.hp,
      isHorde: team.isHorde,
    });
    await this.matches.atualizar(matchId, {
      turnoEquipeId: this.proximoTurno(match),
    });
    return this.view(matchId);
  }

  /** Avança para a próxima onda (palavra) ou encerra a partida. */
  async avancarOnda(matchId: string): Promise<void> {
    const match = await this.carregar(matchId);
    const proximo = match.ondaIndex + 1;
    const jogo = await this.jogos.findById(match.jogoId);

    if (!jogo || proximo >= jogo.palavras.length) {
      const teams = await this.matches.listarTeams(matchId);
      const vencedor = [...teams].sort((a, b) => b.hp - a.hp)[0];
      await this.matches.atualizar(matchId, {
        status: 'ENCERRADO',
        vencedorEquipeId: vencedor?.id ?? null,
        aguardandoDilema: false,
        dilemaEquipeId: null,
      });
      return;
    }

    const palavra = jogo.palavras[proximo];
    await this.matches.atualizar(matchId, {
      ondaIndex: proximo,
      mascara: WorMatchEntity.mascarar(palavra.palavra, new Set()),
      letrasTentadas: [],
      cartasVisiveis: palavra.dicas.slice(0, 1),
      totalCartas: palavra.dicas.length,
      aguardandoDilema: false,
      dilemaEquipeId: null,
      turnoEquipeId: match.ordemEquipes[0],
    });
  }

  private async view(matchId: string): Promise<MatchView> {
    const match = await this.matches.buscar(matchId);
    const teams = await this.matches.listarTeams(matchId);
    return { match: match!, teams };
  }
}
