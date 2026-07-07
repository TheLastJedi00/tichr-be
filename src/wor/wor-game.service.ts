import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorJogoRepository } from './wor-jogo.repository';
import { WorMatchRepository } from './wor-match.repository';
import { MatchView } from './wor-match.service';
import {
  AcaoMembro,
  LIMITE_RODADA_MS,
  ResumoRodada,
  VotoRodada,
  WOR,
  WorMatchEntity,
} from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { PalavraWor } from './entities/wor-jogo.entity';

/** Ação de voto do membro ao chutar a letra: atacar um rival ou comprar dica. */
export type VotoAcao = 'ATACAR' | 'DICA';

/**
 * Motor de turnos do Tichr Wor. O turno é por EQUIPE; dentro do turno, CADA
 * membro age uma vez (chuta letra + vota o alvo, ou arrisca a palavra). A rodada
 * resolve quando todos os membros agiram: revela as letras, apura o voto (rival
 * mais votado entre quem acertou) e aplica o dano — crítico se todos acertaram.
 * Segredo (palavra/dicas) vem de `wor_jogos` (server-only); o cliente só posta.
 */
@Injectable()
export class WorGameService {
  constructor(
    private readonly jogos: WorJogoRepository,
    private readonly matches: WorMatchRepository,
  ) {}

  private async carregar(matchId: string): Promise<WorMatchEntity> {
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
    const team = teams.find((t) => t.membros.some((m) => m.alunoId === alunoId));
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

  private assertNaoJogou(match: WorMatchEntity, alunoId: string): void {
    if (match.acoesRodada.some((a) => a.alunoId === alunoId)) {
      throw new BadRequestException('Você já jogou nesta rodada.');
    }
  }

  /**
   * Chuta uma letra e VOTA a ação da equipe (atacar um rival ou comprar dica).
   * Acumula a ação do membro; a rodada só resolve quando todos os membros jogam.
   */
  async chutarLetra(
    alunoId: string,
    matchId: string,
    letraRaw: string,
    acao: VotoAcao,
    alvoEquipeId?: string,
  ): Promise<MatchView> {
    const match = await this.carregar(matchId);
    this.assertEmAndamento(match);
    const { team, teams } = await this.equipeDoAluno(matchId, alunoId);
    if (team.isHorde) {
      throw new BadRequestException(
        'A Horda só pode tentar a Invasão (arriscar a palavra).',
      );
    }
    this.assertTurno(match, team);
    this.assertNaoJogou(match, alunoId);

    const letra = WorMatchEntity.normalizar(letraRaw);
    if (!/^[A-Z]$/.test(letra)) {
      throw new BadRequestException('Envie uma única letra.');
    }
    const letrasRodada = match.acoesRodada
      .filter((a) => a.tipo === 'LETRA' && a.letra)
      .map((a) => a.letra as string);
    if (match.letrasTentadas.includes(letra) || letrasRodada.includes(letra)) {
      throw new BadRequestException('Essa letra já foi tentada.');
    }

    const voto = this.montarVoto(team, teams, acao, alvoEquipeId);
    const { palavra } = await this.palavraDaOnda(match);
    const acertou = this.reveladas(palavra, [letra]).size > 0;

    const acoesRodada: AcaoMembro[] = [
      ...match.acoesRodada,
      { alunoId, tipo: 'LETRA', letra, acertou, voto, ordem: match.acoesRodada.length },
    ];
    return this.encerrarOuAcumular(matchId, team, acoesRodada);
  }

  /** Valida o voto do membro (atacar exige um rival existente e diferente da própria equipe). */
  private montarVoto(
    team: WorTeamEntity,
    teams: WorTeamEntity[],
    acao: VotoAcao,
    alvoEquipeId?: string,
  ): VotoRodada {
    if (acao === 'DICA') return { tipo: 'DICA' };
    if (!alvoEquipeId || alvoEquipeId === team.id) {
      throw new BadRequestException('Escolha um castelo rival para atacar.');
    }
    if (!teams.some((t) => t.id === alvoEquipeId)) {
      throw new NotFoundException('Equipe alvo não encontrada.');
    }
    return { tipo: 'ATACAR', alvoEquipeId };
  }

  /**
   * Risco Heroico / Invasão: um membro tenta a palavra inteira. Acerto → Cura
   * Massiva (ou Usurpação se Horda) + encerra a onda. Erro → Dano Crítico no
   * PRÓPRIO castelo; a ação conta para a rodada.
   */
  async arriscar(
    alunoId: string,
    matchId: string,
    palpite: string,
  ): Promise<MatchView> {
    const match = await this.carregar(matchId);
    this.assertEmAndamento(match);
    const { team } = await this.equipeDoAluno(matchId, alunoId);
    this.assertTurno(match, team);
    this.assertNaoJogou(match, alunoId);

    const { palavra } = await this.palavraDaOnda(match);
    const acertou =
      WorMatchEntity.normalizar(palpite.trim()) ===
      WorMatchEntity.normalizar(palavra.trim());

    if (acertou) {
      if (team.isHorde) {
        await this.usurpar(matchId, team);
      } else {
        team.curar(WOR.CURA_MASSIVA);
        await this.matches.atualizarTeam(matchId, team.id, { hp: team.hp });
      }
      await this.matches.atualizar(matchId, { acoesRodada: [] });
      await this.avancarOnda(matchId);
      return this.view(matchId);
    }

    // Erro: Dano Crítico no próprio castelo. A ação conta para a rodada.
    team.aplicarDano(WOR.DANO_CRITICO);
    await this.matches.atualizarTeam(matchId, team.id, {
      hp: team.hp,
      isHorde: team.isHorde,
    });
    const acoesRodada: AcaoMembro[] = [
      ...match.acoesRodada,
      { alunoId, tipo: 'ARRISCAR', acertou: false, ordem: match.acoesRodada.length },
    ];
    return this.encerrarOuAcumular(matchId, team, acoesRodada);
  }

  /** Se todos os membros já jogaram, resolve a rodada; senão, só acumula. */
  private async encerrarOuAcumular(
    matchId: string,
    team: WorTeamEntity,
    acoesRodada: AcaoMembro[],
  ): Promise<MatchView> {
    if (acoesRodada.length >= team.membros.length) {
      return this.resolverRodada(matchId, team, acoesRodada);
    }
    await this.matches.atualizar(matchId, { acoesRodada });
    return this.view(matchId);
  }

  /**
   * Resolve a rodada da equipe: revela as letras acertadas; se completou a
   * palavra, encerra a onda; senão apura o voto (rival mais votado entre quem
   * acertou) e aplica o dano (200 se todos acertaram e a equipe tem ≥2 membros;
   * senão 100), ou revela uma dica se "comprar dica" venceu. Passa o turno.
   */
  private async resolverRodada(
    matchId: string,
    team: WorTeamEntity,
    acoes: AcaoMembro[],
    porTempo = false,
  ): Promise<MatchView> {
    const match = await this.carregar(matchId);
    const { palavra, dicas } = await this.palavraDaOnda(match);

    const letrasDaRodada = acoes
      .filter((a) => a.tipo === 'LETRA' && a.letra)
      .map((a) => a.letra as string);
    const letrasTentadas = [...new Set([...match.letrasTentadas, ...letrasDaRodada])];
    const mascara = WorMatchEntity.mascarar(
      palavra,
      this.reveladas(palavra, letrasTentadas),
    );

    const acertadores = acoes.filter((a) => a.tipo === 'LETRA' && a.acertou);
    const resumo: ResumoRodada = {
      seq: (match.resumoRodada?.seq ?? 0) + 1,
      equipeId: team.id,
      equipeNome: team.nome,
      acertadores: acertadores.map((a) => ({
        nome: this.nomeMembro(team, a.alunoId),
        letra: a.letra as string,
      })),
      acao: 'NADA',
      porTempo,
    };

    // Palavra decifrada nesta rodada → encerra a onda (o reveal é o avanço).
    if (WorMatchEntity.estaCompleta(mascara)) {
      await this.matches.atualizar(matchId, {
        letrasTentadas,
        mascara,
        acoesRodada: [],
        resumoRodada: resumo,
      });
      await this.avancarOnda(matchId);
      return this.view(matchId);
    }

    // Apura o voto entre quem acertou a letra.
    let cartasVisiveis = match.cartasVisiveis;
    if (acertadores.length) {
      const vencedor = this.apurarVoto(acertadores);
      if (vencedor.tipo === 'DICA') {
        resumo.acao = 'DICA';
        if (match.cartasVisiveis.length < dicas.length) {
          cartasVisiveis = dicas.slice(0, match.cartasVisiveis.length + 1);
        }
      } else {
        const alvo = await this.matches.buscarTeam(matchId, vencedor.alvoEquipeId);
        if (alvo) {
          const todosAcertaram =
            acoes.length === team.membros.length &&
            acoes.every((a) => a.tipo === 'LETRA' && a.acertou);
          const critico = todosAcertaram && team.membros.length >= 2;
          const dano = critico ? WOR.DANO_CRITICO : WOR.DANO_ATAQUE;
          alvo.aplicarDano(dano);
          await this.matches.atualizarTeam(matchId, alvo.id, {
            hp: alvo.hp,
            isHorde: alvo.isHorde,
          });
          resumo.acao = 'ATACAR';
          resumo.alvoEquipeId = alvo.id;
          resumo.alvoNome = alvo.nome;
          resumo.dano = dano;
          resumo.critico = critico;
        }
      }
    }

    await this.matches.atualizar(matchId, {
      letrasTentadas,
      mascara,
      cartasVisiveis,
      acoesRodada: [],
      turnoEquipeId: this.proximoTurno(match),
      rodadaIniciadaEm: new Date().toISOString(),
      resumoRodada: resumo,
    });
    await this.refletirPlacar(matchId);
    return this.view(matchId);
  }

  /** Nome de um membro da equipe (para o resumo da rodada). */
  private nomeMembro(team: WorTeamEntity, alunoId: string): string {
    return team.membros.find((m) => m.alunoId === alunoId)?.nome ?? 'Aluno';
  }

  /** Grava na raiz o snapshot de todas as equipes (o aluno lê os castelos rivais barato). */
  private async refletirPlacar(matchId: string): Promise<void> {
    const teams = await this.matches.listarTeams(matchId);
    await this.matches.atualizar(matchId, {
      placar: teams.map((t) => ({
        id: t.id,
        nome: t.nome,
        cor: t.cor,
        hp: t.hp,
        isHorde: t.isHorde,
      })),
    });
  }

  /**
   * Encerra a rodada por TEMPO esgotado (cronômetro de 1 min). Disparado pelo
   * projetor do professor; o backend valida o prazo antes de resolver.
   */
  async resolverPorTempo(professorId: string, matchId: string): Promise<MatchView> {
    const match = await this.carregar(matchId);
    if (match.professorId !== professorId) {
      throw new ForbiddenException('Essa partida não é sua.');
    }
    this.assertEmAndamento(match);
    if (!match.turnoEquipeId) return this.view(matchId);
    const inicio = match.rodadaIniciadaEm ? Date.parse(match.rodadaIniciadaEm) : 0;
    if (inicio && Date.now() - inicio < LIMITE_RODADA_MS - 2000) {
      return this.view(matchId); // ainda não esgotou (margem p/ o relógio do cliente)
    }
    const teams = await this.matches.listarTeams(matchId);
    const team = teams.find((t) => t.id === match.turnoEquipeId);
    if (!team) return this.view(matchId);
    return this.resolverRodada(matchId, team, match.acoesRodada, true);
  }

  /**
   * Apura o voto dos acertadores: a ação mais votada vence. Empate → vale o voto
   * do primeiro que acertou; se ele não estiver entre as empatadas (raro), sorteia.
   */
  private apurarVoto(acertadores: AcaoMembro[]): VotoRodada {
    const chave = (v: VotoRodada) =>
      v.tipo === 'DICA' ? 'DICA' : `ATACAR:${v.alvoEquipeId}`;
    const contagem = new Map<string, number>();
    for (const a of acertadores) {
      if (!a.voto) continue;
      const k = chave(a.voto);
      contagem.set(k, (contagem.get(k) ?? 0) + 1);
    }
    const max = Math.max(...contagem.values());
    const empatadas = [...contagem.entries()]
      .filter(([, n]) => n === max)
      .map(([k]) => k);

    let vencedora: string;
    if (empatadas.length === 1) {
      vencedora = empatadas[0];
    } else {
      const primeiro = [...acertadores].sort((a, b) => a.ordem - b.ordem)[0];
      const chavePrimeiro = primeiro.voto ? chave(primeiro.voto) : '';
      vencedora = empatadas.includes(chavePrimeiro)
        ? chavePrimeiro
        : empatadas[Math.floor(Math.random() * empatadas.length)];
    }
    return vencedora === 'DICA'
      ? { tipo: 'DICA' }
      : { tipo: 'ATACAR', alvoEquipeId: vencedora.slice('ATACAR:'.length) };
  }

  /**
   * Usurpação: a Horda `invasora` toma o castelo da equipe de MAIOR HP (o líder),
   * que vira a nova Horda. Sem líder (todos hordas), reergue o próprio com HP cheio.
   */
  private async usurpar(matchId: string, invasora: WorTeamEntity): Promise<void> {
    const teams = await this.matches.listarTeams(matchId);
    const lider = teams
      .filter((t) => t.id !== invasora.id && !t.isHorde && t.hp > 0)
      .sort((a, b) => b.hp - a.hp)[0];

    if (!lider) {
      await this.matches.atualizarTeam(matchId, invasora.id, {
        hp: WOR.HP_INICIAL,
        isHorde: false,
      });
      return;
    }
    await this.matches.atualizarTeam(matchId, invasora.id, {
      hp: lider.hp,
      isHorde: false,
    });
    await this.matches.atualizarTeam(matchId, lider.id, { hp: 0, isHorde: true });
  }

  /** Controle do mestre: pula a palavra atual (avança a onda). Valida posse. */
  async pularPalavra(professorId: string, matchId: string): Promise<MatchView> {
    const match = await this.carregar(matchId);
    if (match.professorId !== professorId) {
      throw new ForbiddenException('Essa partida não é sua.');
    }
    await this.avancarOnda(matchId);
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
        acoesRodada: [],
        rodadaIniciadaEm: null,
      });
      await this.refletirPlacar(matchId);
      return;
    }

    const palavra = jogo.palavras[proximo];
    await this.matches.atualizar(matchId, {
      ondaIndex: proximo,
      mascara: WorMatchEntity.mascarar(palavra.palavra, new Set()),
      letrasTentadas: [],
      cartasVisiveis: palavra.dicas.slice(0, 1),
      totalCartas: palavra.dicas.length,
      acoesRodada: [],
      turnoEquipeId: match.ordemEquipes[0],
      rodadaIniciadaEm: new Date().toISOString(),
    });
    await this.refletirPlacar(matchId);
  }

  private async view(matchId: string): Promise<MatchView> {
    const match = await this.matches.buscar(matchId);
    const teams = await this.matches.listarTeams(matchId);
    return { match: match!, teams };
  }
}
