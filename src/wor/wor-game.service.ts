import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  creditoDe,
  creditosDaPartida,
  ItemLogPontos,
  LogPontuacaoJogador,
} from '../common/log-pontuacao';
import { valeRanking } from '../common/vale-ranking';
import { assertPausavel, empurrar, tempoPausado } from '../common/pausa';
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
import { EfeitoRisco } from './dto/arriscar.dto';

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
      {
        alunoId,
        tipo: 'LETRA',
        letra,
        acertou,
        voto,
        ordem: match.acoesRodada.length,
      },
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
   * Risco Heroico / Invasão: um membro tenta a palavra inteira. Acerto → o
   * efeito escolhido por ele no envio (Recuperar HP ou Catapulta num rival;
   * Usurpação se Horda) + encerra a onda. Erro → Dano Crítico no PRÓPRIO
   * castelo; a ação conta para a rodada e o efeito escolhido é ignorado.
   */
  async arriscar(
    alunoId: string,
    matchId: string,
    palpite: string,
    opcoes: { efeito?: EfeitoRisco; alvoEquipeId?: string } = {},
  ): Promise<MatchView> {
    const match = await this.carregar(matchId);
    this.assertEmAndamento(match);
    const { team, teams } = await this.equipeDoAluno(matchId, alunoId);
    this.assertTurno(match, team);
    this.assertNaoJogou(match, alunoId);
    // Antes de conferir a palavra: um envio malformado não pode queimar a
    // tentativa — nem revelar se o palpite estava certo.
    const catapultaEm = this.alvoDaCatapulta(team, teams, opcoes);

    const { palavra } = await this.palavraDaOnda(match);
    const acertou =
      WorMatchEntity.normalizar(palpite.trim()) ===
      WorMatchEntity.normalizar(palavra.trim());

    const aluno = this.nomeMembro(team, alunoId);
    const patches: Record<string, Partial<WorTeamEntity>> = {};
    const rodada = (match.resumoRodada?.seq ?? 0) + 1;

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
      } else if (catapultaEm) {
        // O dano que vira ponto é o que de fato saiu do castelo (um alvo com
        // 200 de HP só perde 200).
        const antes = catapultaEm.hp;
        const caiu = catapultaEm.aplicarDano(WOR.DANO_CATAPULTA);
        const dano = antes - catapultaEm.hp;
        patches[catapultaEm.id] = {
          hp: catapultaEm.hp,
          isHorde: catapultaEm.isHorde,
        };
        const ganho = this.pontos(match, dano * WOR.PONTOS_POR_DANO);
        team.pontos = (team.pontos ?? 0) + ganho;
        this.anotar(match, team, patches, {
          rodada,
          fonte: 'CATAPULTA',
          descricao: `Rodada ${rodada}: ${aluno} disparou a Catapulta no castelo da ${catapultaEm.nome}, ${dano} de dano`,
          pontos: ganho,
        });
        card = this.montarCard(
          match,
          'CATAPULTA',
          `${aluno} acertou a palavra e disparou a Catapulta! O castelo da ${catapultaEm.nome} sofreu ${dano} de dano${caiu ? ' e caiu' : ''}!`,
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
      const bonus = this.pontos(match, WOR.BONUS_ARRISCAR);
      team.pontos = (team.pontos ?? 0) + bonus;
      this.anotar(match, team, patches, {
        rodada,
        fonte: 'ARRISCAR',
        descricao: `Rodada ${rodada}: ${aluno} arriscou a palavra inteira e acertou`,
        pontos: bonus,
      });

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
      {
        alunoId,
        tipo: 'ARRISCAR',
        acertou: false,
        ordem: match.acoesRodada.length,
      },
    ];
    // `congelado`: o card do Dano Crítico já está em cartaz — se a rodada
    // resolver agora (este era o último membro), ela não emite um segundo card
    // por cima; o reveal continua chegando pelo `resumoRodada`.
    return this.encerrarOuAcumular(matchId, team, acoesRodada, true);
  }

  /**
   * Linguagem imprópria no chat: o castelo da equipe perde HP (pode cair e virar
   * Horda), o aluno perde XP no ranking da sala e o alerta, com o nome dele, vai
   * ao telão e à equipe infratora — sem fan-out para as rivais, que não têm
   * nada com a mensagem. O card congela a rodada em curso, como os demais.
   */
  async penalizarModeracao(matchId: string, alunoId: string): Promise<void> {
    const match = await this.carregar(matchId);
    const { team, teams } = await this.equipeDoAluno(matchId, alunoId);
    const aluno = this.nomeMembro(team, alunoId);

    const tinhaHp = team.hp > 0;
    if (tinhaHp) team.aplicarDano(WOR.PENALIDADE_HP);
    const card = this.montarCard(
      match,
      'MODERACAO',
      tinhaHp
        ? `⚠ ${aluno} usou linguagem imprópria no chat. −${WOR.PENALIDADE_HP} HP para ${team.nome}.`
        : `⚠ ${aluno} usou linguagem imprópria no chat.`,
    );
    await this.matches.commitPartida(
      matchId,
      {
        lastGlobalAction: card,
        rodadaIniciadaEm: this.adiarRodada(match.rodadaIniciadaEm),
        placar: this.placarDe(teams),
      },
      {
        [team.id]: {
          hp: team.hp,
          isHorde: team.isHorde,
          lastGlobalAction: card,
        },
      },
    );

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
   * Valida o efeito escolhido para o Risco Heroico. Devolve o castelo alvo da
   * Catapulta, ou `null` quando o efeito é Recuperar HP (o padrão). A Horda não
   * escolhe — acertar, para ela, é sempre a Usurpação —, então o que ela mandar
   * é ignorado.
   */
  private alvoDaCatapulta(
    team: WorTeamEntity,
    teams: WorTeamEntity[],
    opcoes: { efeito?: EfeitoRisco; alvoEquipeId?: string },
  ): WorTeamEntity | null {
    if (team.isHorde || opcoes.efeito !== 'CATAPULTA') return null;
    const alvo = teams.find((t) => t.id === opcoes.alvoEquipeId);
    if (!alvo || alvo.id === team.id) {
      throw new BadRequestException(
        'Escolha um castelo rival para a Catapulta.',
      );
    }
    if (alvo.isHorde || alvo.hp <= 0) {
      throw new BadRequestException(
        'Esse castelo já caiu. Escolha um castelo de pé para a Catapulta.',
      );
    }
    return alvo;
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
    const letrasTentadas = [
      ...new Set([...match.letrasTentadas, ...letrasDaRodada]),
    ];
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
          const ganho = this.pontos(match, dano * WOR.PONTOS_POR_DANO);
          team.pontos = (team.pontos ?? 0) + ganho;
          const quem = acertadores
            .map((a) => this.nomeMembro(team, a.alunoId))
            .join(', ');
          const n = acertadores.length;
          this.anotar(match, team, patches, {
            rodada: resumo.seq,
            fonte: critico ? 'CRITICO' : 'DANO',
            descricao: `Rodada ${resumo.seq}: a equipe acertou ${n} ${n === 1 ? 'letra' : 'letras'} (${quem}) e ${critico ? 'deu um ataque crítico no' : 'atacou o'} castelo da ${alvo.nome}, ${dano} de dano`,
            pontos: ganho,
          });
          resumo.acao = 'ATACAR';
          resumo.alvoEquipeId = alvo.id;
          resumo.alvoNome = alvo.nome;
          resumo.dano = dano;
          resumo.critico = critico;

          // O ataque é da EQUIPE: o dano nasce da votação da rodada inteira, não
          // de um aluno — narrar um nome só seria dar crédito a quem votou. (O
          // log de fim de partida lista quem acertou letra, não quem votou.)
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
  async resolverPorTempo(
    professorId: string,
    matchId: string,
  ): Promise<MatchView> {
    const match = await this.carregar(matchId);
    if (match.professorId !== professorId) {
      throw new ForbiddenException('Essa partida não é sua.');
    }
    this.assertEmAndamento(match);
    if (!match.turnoEquipeId) return this.view(matchId);
    const inicio = match.rodadaIniciadaEm
      ? Date.parse(match.rodadaIniciadaEm)
      : 0;
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

  // ===== Pausa (028 §4) =====

  private assertDono(match: WorMatchEntity, professorId: string): void {
    if (match.professorId !== professorId) {
      throw new ForbiddenException('Essa partida não é sua.');
    }
  }

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
      this.fanOut(
        raiz,
        patches,
        await this.matches.listarTeams(matchId),
        emCartaz,
      );
    }
    await this.matches.commitPartida(matchId, raiz, patches);
    return this.view(matchId);
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
    const rodada = (match.resumoRodada?.seq ?? 0) + 1;
    for (const t of teams) {
      const patches: Record<string, Partial<WorTeamEntity>> = {};
      const bonus = this.pontos(match, t.hp * WOR.BONUS_HP_FATOR);
      t.pontos = (t.pontos ?? 0) + bonus;
      this.anotar(match, t, patches, {
        rodada,
        fonte: 'HP_FINAL',
        descricao: `Fim da batalha: castelo de pé com ${t.hp} de HP`,
        pontos: bonus,
      });
      await this.matches.atualizarTeam(matchId, t.id, patches[t.id]);
    }

    // Vencedor = maior HP; empate desempatado por pontos (reduz empates ~a zero).
    const vencedor = [...teams].sort(
      (a, b) => b.hp - a.hp || (b.pontos ?? 0) - (a.pontos ?? 0),
    )[0];

    // Pontos do jogo → XP do ranking da sala (mesmo caminho do Qlick), exceto
    // em partida casual.
    const ganhos: Array<{ alunoId: string; pontos: number }> = [];
    for (const t of teams) {
      const ganho = this.ganhoDaEquipe(t, vencedor?.id);
      if (ganho <= 0) continue;
      for (const m of t.membros) {
        ganhos.push({ alunoId: m.alunoId, pontos: ganho });
      }
    }
    const creditos = vencedor ? creditosDaPartida(match, ganhos) : [];

    await this.matches.atualizar(matchId, {
      status: 'ENCERRADO',
      vencedorEquipeId: vencedor?.id ?? null,
      acoesRodada: [],
      rodadaIniciadaEm: null,
      logPontuacao: this.montarLog(teams, vencedor?.id, creditos, rodada),
    });
    await this.refletirPlacar(matchId);

    if (match.turmaId && vencedor && valeRanking(match)) {
      await this.xp.creditarPartida(match.turmaId, creditos, 'WOR');
    }
  }

  /**
   * O log de cada aluno (spec 027 §1.3): os pontos são da equipe, então todo
   * membro recebe os mesmos itens. A não campeã ganha o item do fator ×0,5,
   * para a soma bater com o crédito real.
   */
  private montarLog(
    teams: WorTeamEntity[],
    vencedorId: string | undefined,
    creditos: Array<{ alunoId: string; pontos: number }>,
    rodada: number,
  ): LogPontuacaoJogador[] {
    return teams.flatMap((t) => {
      const total = t.pontos ?? 0;
      const corte = this.ganhoDaEquipe(t, vencedorId) - total;
      const itens: ItemLogPontos[] = [...(t.logPontos ?? [])];
      if (corte !== 0) {
        itens.push({
          rodada,
          fonte: 'FATOR_COLOCACAO',
          descricao: 'Equipe não campeã: ×0,5 no ranking',
          pontos: corte,
        });
      }
      return t.membros.map((m) => ({
        alunoId: m.alunoId,
        nome: m.nome,
        totalPartida: total,
        creditoRanking: creditoDe(creditos, m.alunoId),
        itens,
      }));
    });
  }

  /**
   * Registra no log da equipe o ponto que acabou de entrar em `team.pontos`,
   * no mesmo patch (spec 027 §1.3). O multiplicador já está no valor e vai na
   * descrição quando passa de 1x.
   */
  private anotar(
    match: WorMatchEntity,
    team: WorTeamEntity,
    patches: Record<string, Partial<WorTeamEntity>>,
    item: ItemLogPontos,
  ): void {
    const mult = match.multiplicador ?? 1;
    if (item.pontos !== 0) {
      team.logPontos = [
        ...(team.logPontos ?? []),
        mult > 1
          ? { ...item, descricao: `${item.descricao} (×${mult})` }
          : item,
      ];
    }
    patches[team.id] = {
      ...(patches[team.id] ?? {}),
      pontos: team.pontos,
      logPontos: team.logPontos ?? [],
    };
  }

  /** Pontos da equipe → XP do ranking (campeã ×1, demais ×0,5). */
  private ganhoDaEquipe(team: WorTeamEntity, vencedorId?: string): number {
    const fator = team.id === vencedorId ? 1 : 0.5;
    return Math.round((team.pontos ?? 0) * WOR.XP_POR_PONTO * fator);
  }

  /**
   * Os pontos que a equipe ganha, já com o multiplicador da partida (1x a 10x,
   * escolhido no lobby). Partida antiga, sem o campo, vale 1x.
   */
  private pontos(match: WorMatchEntity, base: number): number {
    return Math.round(base * (match.multiplicador ?? 1));
  }

  private async view(matchId: string): Promise<MatchView> {
    const match = await this.matches.buscar(matchId);
    const teams = await this.matches.listarTeams(matchId);
    return { match: match!, teams };
  }
}
