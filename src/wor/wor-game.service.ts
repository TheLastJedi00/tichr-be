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
  LastGlobalAction,
  LIMITE_RODADA_MS,
  PlacarEquipe,
  ResumoRodada,
  TipoAcaoGlobal,
  VotoRodada,
  WOR,
  WorMatchEntity,
} from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { PalavraWor } from './entities/wor-jogo.entity';
import { XpService } from '../turma/xp.service';

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
    private readonly xp: XpService,
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

  // ===== Action Cards (narração global + freeze de 3s) =====

  /** Novo card, com `seq` seguindo o último emitido na partida. */
  private montarCard(
    match: WorMatchEntity,
    tipo: TipoAcaoGlobal,
    mensagem: string,
  ): LastGlobalAction {
    return {
      seq: (match.lastGlobalAction?.seq ?? 0) + 1,
      tipo,
      mensagem,
      duracaoMs: WOR.FREEZE_MS,
      em: new Date().toISOString(),
    };
  }

  /**
   * Fan-out: o card entra na raiz (telão) e no doc de CADA equipe (celulares).
   * Sem isso o aluno, que só escuta o próprio doc, ficaria fora da narrativa.
   */
  private fanOut(
    raiz: Partial<WorMatchEntity>,
    patches: Record<string, Partial<WorTeamEntity>>,
    teams: WorTeamEntity[],
    card: LastGlobalAction | null,
  ): void {
    if (!card) return;
    raiz.lastGlobalAction = card;
    for (const t of teams) {
      patches[t.id] = { ...(patches[t.id] ?? {}), lastGlobalAction: card };
    }
  }

  /**
   * Início da rodada nova. Com um card no ar, nasce 3s no FUTURO: é assim que o
   * jogo "congela" — o cronômetro do cliente é derivado deste instante, então
   * ele só passa a correr quando o card sai de cena. Não existe timer no
   * servidor para pausar, e ninguém precisa destravar nada depois.
   */
  private inicioDaRodada(freeze: boolean): string {
    return new Date(Date.now() + (freeze ? WOR.FREEZE_MS : 0)).toISOString();
  }

  /** Empurra o relógio da rodada EM CURSO (o card interrompe sem encurtá-la). */
  private adiarRodada(inicio?: string | null): string | null {
    if (!inicio) return inicio ?? null;
    return new Date(Date.parse(inicio) + WOR.FREEZE_MS).toISOString();
  }

  /** Snapshot das equipes para a raiz (calculado em memória, sem reler o banco). */
  private placarDe(teams: WorTeamEntity[]): PlacarEquipe[] {
    return teams.map((t) => ({
      id: t.id,
      nome: t.nome,
      cor: t.cor,
      hp: t.hp,
      isHorde: t.isHorde,
      pontos: t.pontos ?? 0,
    }));
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
    const { team, teams } = await this.equipeDoAluno(matchId, alunoId);
    this.assertTurno(match, team);
    this.assertNaoJogou(match, alunoId);

    const { palavra } = await this.palavraDaOnda(match);
    const acertou =
      WorMatchEntity.normalizar(palpite.trim()) ===
      WorMatchEntity.normalizar(palavra.trim());

    const aluno = this.nomeMembro(team, alunoId);
    const patches: Record<string, Partial<WorTeamEntity>> = {};

    if (acertou) {
      let card: LastGlobalAction;
      if (team.isHorde) {
        const lider = this.usurpar(team, teams, patches);
        card = this.montarCard(
          match,
          'USURPACAO',
          lider
            ? `A Horda de ${aluno} acertou a palavra e ROUBOU o castelo da ${lider.nome}!`
            : `A Horda de ${aluno} acertou a palavra e reergueu o próprio castelo!`,
        );
      } else {
        team.curar(WOR.CURA_MASSIVA);
        patches[team.id] = { ...(patches[team.id] ?? {}), hp: team.hp };
        card = this.montarCard(
          match,
          'CURA',
          `${aluno} arriscou tudo e acertou a palavra! A ${team.nome} restaurou a vida do castelo!`,
        );
      }
      // Arriscar tudo e acertar rende pontos extras (desempate + ranking).
      team.pontos = (team.pontos ?? 0) + WOR.BONUS_ARRISCAR;
      patches[team.id] = { ...(patches[team.id] ?? {}), pontos: team.pontos };

      const raiz: Partial<WorMatchEntity> = { acoesRodada: [] };
      this.fanOut(raiz, patches, teams, card);
      await this.matches.commitPartida(matchId, raiz, patches);
      // A onda nova nasce congelada: o card ainda está no ar.
      await this.avancarOnda(matchId, true);
      return this.view(matchId);
    }

    // Erro: Dano Crítico no próprio castelo. A ação conta para a rodada.
    team.aplicarDano(WOR.DANO_CRITICO);
    patches[team.id] = { hp: team.hp, isHorde: team.isHorde };
    const card = this.montarCard(
      match,
      'DANO_CRITICO',
      `${aluno} arriscou a palavra e errou! A ${team.nome} sofreu Dano Crítico!`,
    );
    const raiz: Partial<WorMatchEntity> = {
      // A rodada em curso continua: só ganha os 3s que o card rouba dela.
      rodadaIniciadaEm: this.adiarRodada(match.rodadaIniciadaEm),
      placar: this.placarDe(teams),
    };
    this.fanOut(raiz, patches, teams, card);
    await this.matches.commitPartida(matchId, raiz, patches);

    const acoesRodada: AcaoMembro[] = [
      ...match.acoesRodada,
      { alunoId, tipo: 'ARRISCAR', acertou: false, ordem: match.acoesRodada.length },
    ];
    // `congelado`: o card do Dano Crítico já está em cartaz — se a rodada
    // resolver agora (este era o último membro), ela não emite um segundo card
    // por cima; o reveal continua chegando pelo `resumoRodada`.
    return this.encerrarOuAcumular(matchId, team, acoesRodada, true);
  }

  /** Se todos os membros já jogaram, resolve a rodada; senão, só acumula. */
  private async encerrarOuAcumular(
    matchId: string,
    team: WorTeamEntity,
    acoesRodada: AcaoMembro[],
    congelado = false,
  ): Promise<MatchView> {
    if (acoesRodada.length >= team.membros.length) {
      return this.resolverRodada(matchId, team, acoesRodada, false, congelado);
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
    equipeDoTurno: WorTeamEntity,
    acoes: AcaoMembro[],
    porTempo = false,
    congelado = false,
  ): Promise<MatchView> {
    const match = await this.carregar(matchId);
    const { palavra, dicas } = await this.palavraDaOnda(match);
    // Trabalha sobre a lista completa: os efeitos são aplicados em memória e o
    // placar sai daqui, sem releitura.
    const teams = await this.matches.listarTeams(matchId);
    const team = teams.find((t) => t.id === equipeDoTurno.id) ?? equipeDoTurno;

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
      await this.avancarOnda(matchId, congelado);
      return this.view(matchId);
    }

    // Apura o voto entre quem acertou a letra.
    const patches: Record<string, Partial<WorTeamEntity>> = {};
    let card: LastGlobalAction | null = null;
    let cartasVisiveis = match.cartasVisiveis;
    if (acertadores.length) {
      const vencedor = this.apurarVoto(acertadores);
      if (vencedor.tipo === 'DICA') {
        resumo.acao = 'DICA';
        if (match.cartasVisiveis.length < dicas.length) {
          cartasVisiveis = dicas.slice(0, match.cartasVisiveis.length + 1);
          card = this.montarCard(
            match,
            'DICA',
            `A ${team.nome} sacrificou seu ataque para revelar a Carta ${cartasVisiveis.length}!`,
          );
        }
      } else {
        const alvo = teams.find((t) => t.id === vencedor.alvoEquipeId);
        if (alvo) {
          const todosAcertaram =
            acoes.length === team.membros.length &&
            acoes.every((a) => a.tipo === 'LETRA' && a.acertou);
          const critico = todosAcertaram && team.membros.length >= 2;
          const dano = critico ? WOR.DANO_CRITICO : WOR.DANO_ATAQUE;
          alvo.aplicarDano(dano);
          patches[alvo.id] = { hp: alvo.hp, isHorde: alvo.isHorde };
          // O dano causado vira pontos da equipe atacante (desempate + ranking).
          team.pontos = (team.pontos ?? 0) + dano * WOR.PONTOS_POR_DANO;
          patches[team.id] = { ...(patches[team.id] ?? {}), pontos: team.pontos };
          resumo.acao = 'ATACAR';
          resumo.alvoEquipeId = alvo.id;
          resumo.alvoNome = alvo.nome;
          resumo.dano = dano;
          resumo.critico = critico;

          // O ataque é da EQUIPE: o dano nasce da votação da rodada inteira, não
          // de um aluno — narrar um nome só seria dar crédito a quem votou.
          const n = acertadores.length;
          card = this.montarCard(
            match,
            'ATAQUE',
            `A ${team.nome} acertou ${n} ${n === 1 ? 'letra' : 'letras'} e causou ${dano} de dano no castelo da ${alvo.nome}!`,
          );
        }
      }
    }
    // Já há um card em cartaz nesta requisição (Dano Crítico): não sobrepõe.
    if (congelado) card = null;

    const freeze = congelado || !!card;
    const raiz: Partial<WorMatchEntity> = {
      letrasTentadas,
      mascara,
      cartasVisiveis,
      acoesRodada: [],
      turnoEquipeId: this.proximoTurno(match),
      rodadaIniciadaEm: this.inicioDaRodada(freeze),
      resumoRodada: resumo,
      placar: this.placarDe(teams),
    };
    this.fanOut(raiz, patches, teams, card);
    await this.matches.commitPartida(matchId, raiz, patches);
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
        pontos: t.pontos ?? 0,
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
   * Aplica os efeitos em memória e devolve o líder deposto (para narrar o card);
   * quem persiste é o chamador, no mesmo commit do fan-out.
   */
  private usurpar(
    invasora: WorTeamEntity,
    teams: WorTeamEntity[],
    patches: Record<string, Partial<WorTeamEntity>>,
  ): WorTeamEntity | null {
    const lider = teams
      .filter((t) => t.id !== invasora.id && !t.isHorde && t.hp > 0)
      .sort((a, b) => b.hp - a.hp)[0];

    if (!lider) {
      invasora.hp = WOR.HP_INICIAL;
      invasora.isHorde = false;
      patches[invasora.id] = { hp: invasora.hp, isHorde: false };
      return null;
    }
    invasora.hp = lider.hp;
    invasora.isHorde = false;
    lider.hp = 0;
    lider.isHorde = true;
    patches[invasora.id] = { hp: invasora.hp, isHorde: false };
    patches[lider.id] = { hp: 0, isHorde: true };
    return lider;
  }

  /** Controle do mestre: pula a palavra atual (avança a onda). Valida posse. */
  async pularPalavra(professorId: string, matchId: string): Promise<MatchView> {
    const match = await this.carregar(matchId);
    if (match.professorId !== professorId) {
      throw new ForbiddenException('Essa partida não é sua.');
    }
    // Pular não consome a rodada: a equipe da vez segue com o turno na palavra nova.
    await this.avancarOnda(matchId, false, true);
    return this.view(matchId);
  }

  /**
   * Avança para a próxima onda (palavra) ou encerra a partida. Com `congelado`,
   * a rodada nova já nasce 3s à frente — há um Action Card ainda no ar. Com
   * `manterTurno`, a equipe da vez continua na onda nova (ninguém jogou a
   * rodada — é o caso do mestre pulando a palavra).
   */
  async avancarOnda(
    matchId: string,
    congelado = false,
    manterTurno = false,
  ): Promise<void> {
    const match = await this.carregar(matchId);
    if (match.status === 'ENCERRADO') return; // idempotência (não credita 2x)
    const proximo = match.ondaIndex + 1;
    const jogo = await this.jogos.findById(match.jogoId);

    if (!jogo || proximo >= jogo.palavras.length) {
      await this.encerrarPartida(match);
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
      // O rodízio continua de onde parou: a onda nova começa na PRÓXIMA equipe,
      // não na primeira. `match` ainda traz o turno de quem acabou de jogar.
      turnoEquipeId: manterTurno
        ? (match.turnoEquipeId ?? match.ordemEquipes[0])
        : this.proximoTurno(match),
      rodadaIniciadaEm: this.inicioDaRodada(congelado),
    });
    await this.refletirPlacar(matchId);
  }

  /**
   * Encerra a partida: aplica o bônus de intactez (HP restante vira pontos),
   * elege o vencedor por MAIOR HP com DESEMPATE por pontos, e credita os pontos
   * no ranking da sala (campeã ×1, demais ×0,5) — refletindo no XP dos alunos.
   */
  private async encerrarPartida(match: WorMatchEntity): Promise<void> {
    const matchId = match.id;
    const teams = await this.matches.listarTeams(matchId);

    // Bônus de fim: terminar intacto rende pontos (reforça o desempate).
    for (const t of teams) {
      t.pontos = (t.pontos ?? 0) + Math.round(t.hp * WOR.BONUS_HP_FATOR);
      await this.matches.atualizarTeam(matchId, t.id, { pontos: t.pontos });
    }

    // Vencedor = maior HP; empate desempatado por pontos (reduz empates ~a zero).
    const vencedor = [...teams].sort(
      (a, b) => b.hp - a.hp || (b.pontos ?? 0) - (a.pontos ?? 0),
    )[0];

    await this.matches.atualizar(matchId, {
      status: 'ENCERRADO',
      vencedorEquipeId: vencedor?.id ?? null,
      acoesRodada: [],
      rodadaIniciadaEm: null,
    });
    await this.refletirPlacar(matchId);

    // Pontos do jogo → XP do ranking da sala (mesmo caminho do Qlick).
    if (match.turmaId && vencedor) {
      const creditos: Array<{ alunoId: string; pontos: number }> = [];
      for (const t of teams) {
        const fator = t.id === vencedor.id ? 1 : 0.5;
        const ganho = Math.round((t.pontos ?? 0) * WOR.XP_POR_PONTO * fator);
        if (ganho <= 0) continue;
        for (const m of t.membros) {
          creditos.push({ alunoId: m.alunoId, pontos: ganho });
        }
      }
      await this.xp.creditarPartida(match.turmaId, creditos, 'WOR');
    }
  }

  private async view(matchId: string): Promise<MatchView> {
    const match = await this.matches.buscar(matchId);
    const teams = await this.matches.listarTeams(matchId);
    return { match: match!, teams };
  }
}
