import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  creditoDe,
  creditosDaPartida,
  ItemLogPontos,
  LogPontuacaoJogador,
} from '../common/log-pontuacao';
import { valeRanking } from '../common/vale-ranking';
import { MudancasWor } from './wor-match.repository';
import {
  AcaoMembro,
  LastGlobalAction,
  LIMITE_RODADA_MS,
  PlacarEquipe,
  ResultadoRodadaEquipe,
  TipoAcaoGlobal,
  VotoRodada,
  WOR,
  WorMatchEntity,
  WorRodadaPrivada,
} from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { PalavraWor, WorJogoEntity } from './entities/wor-jogo.entity';
import { EfeitoRisco } from './dto/arriscar.dto';

/** Ação de voto do membro ao chutar a letra: atacar um rival ou comprar dica. */
export type VotoAcao = 'ATACAR' | 'DICA';

/** Crédito do ranking a aplicar depois do commit (fora da transação). */
export interface CreditoPendente {
  turmaId: string;
  creditos: Array<{ alunoId: string; pontos: number }>;
}

/**
 * Motor da rodada em paralelo do Tichr Wor (029). Não há turno: todas as
 * equipes jogam a mesma palavra no mesmo relógio. Cada membro age uma vez
 * (chuta letra + vota, ou arrisca a palavra). A equipe FECHA quando todos os
 * membros agiram e aplica o dano na hora: quem fecha primeiro bate primeiro. A
 * RODADA fecha quando todas as equipes fecharam ou o tempo acaba, e só então as
 * letras e as dicas aparecem.
 *
 * É puro: roda dentro da transação do repositório (`WorMatchRepository.transacao`)
 * sobre o estado lido nela, e pode rodar mais de uma vez se o Firestore repetir.
 * Por isso não faz I/O; o crédito do ranking sai em `creditoPendente`.
 */
export class MotorWor {
  /** Equipes alteradas neste comando (só elas são gravadas). */
  private readonly sujas = new Set<string>();
  private card: {
    tipo: TipoAcaoGlobal;
    mensagens: string[];
    /** Só a raiz e esta equipe recebem o card (moderação). */
    soEquipe?: string;
  } | null = null;
  /** O comando abriu uma rodada nova (fechou a anterior ou trocou a onda). */
  private novaRodada = false;
  /** Preenchido quando o comando encerra a partida. */
  creditoPendente: CreditoPendente | null = null;

  constructor(
    readonly match: WorMatchEntity,
    readonly teams: WorTeamEntity[],
    private rodada: WorRodadaPrivada,
    private readonly jogo: WorJogoEntity,
    private readonly agora = Date.now(),
  ) {}

  // ===== Comandos =====

  /** Chuta uma letra e vota a ação da equipe (atacar um rival ou comprar dica). */
  chutarLetra(
    alunoId: string,
    letraRaw: string,
    acao: VotoAcao,
    alvoEquipeId?: string,
  ): void {
    this.assertEmAndamento();
    const team = this.equipeDoAluno(alunoId);
    if (team.isHorde) {
      throw new BadRequestException(
        'A Horda só pode tentar a Invasão (arriscar a palavra).',
      );
    }
    this.assertPodeAgir(team, alunoId);

    const letra = WorMatchEntity.normalizar(letraRaw);
    if (!/^[A-Z]$/.test(letra)) {
      throw new BadRequestException('Envie uma única letra.');
    }
    // Entre equipes a letra pode repetir na mesma rodada (029 #3): ninguém
    // sabe o que a outra chutou.
    const daEquipe = this.acoesDa(team.id)
      .filter((a) => a.tipo === 'LETRA')
      .map((a) => a.letra);
    if (this.match.letrasTentadas.includes(letra) || daEquipe.includes(letra)) {
      throw new BadRequestException('Essa letra já foi tentada.');
    }

    const voto = this.montarVoto(team, acao, alvoEquipeId);
    const acertou = this.reveladas([letra]).size > 0;
    this.registrar({
      alunoId,
      equipeId: team.id,
      tipo: 'LETRA',
      letra,
      acertou,
      voto,
    });
    this.depoisDaAcao(team);
  }

  /**
   * Risco Heroico / Invasão: um membro tenta a palavra inteira. Acerto → o
   * efeito escolhido (Recuperar HP ou Catapulta; Usurpação se Horda) e a onda
   * acaba na hora para todos. Erro → Dano Crítico no próprio castelo, no feed;
   * a ação conta para a equipe.
   */
  arriscar(
    alunoId: string,
    palpite: string,
    opcoes: { efeito?: EfeitoRisco; alvoEquipeId?: string } = {},
  ): void {
    this.assertEmAndamento();
    const team = this.equipeDoAluno(alunoId);
    this.assertPodeAgir(team, alunoId);
    // Antes de conferir a palavra: um envio malformado não pode queimar a
    // tentativa — nem revelar se o palpite estava certo.
    const catapultaEm = this.alvoDaCatapulta(team, opcoes);

    const { palavra } = this.palavra();
    const acertou =
      WorMatchEntity.normalizar(palpite.trim()) ===
      WorMatchEntity.normalizar(palavra.trim());
    const aluno = this.nomeMembro(team, alunoId);
    const rodada = this.numeroRodada();

    if (acertou) {
      if (team.isHorde) {
        const lider = this.usurpar(team);
        this.emitirCard(
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
        this.sujas.add(catapultaEm.id);
        this.ganhar(team, dano * WOR.PONTOS_POR_DANO, {
          rodada,
          fonte: 'CATAPULTA',
          descricao: `Rodada ${rodada}: ${aluno} disparou a Catapulta no castelo da ${catapultaEm.nome}, ${dano} de dano`,
        });
        this.emitirCard(
          'CATAPULTA',
          `${aluno} acertou a palavra e disparou a Catapulta! O castelo da ${catapultaEm.nome} sofreu ${dano} de dano${caiu ? ' e caiu' : ''}!`,
        );
      } else {
        team.curar(WOR.CURA_MASSIVA);
        this.sujas.add(team.id);
        this.emitirCard(
          'CURA',
          `${aluno} arriscou tudo e acertou a palavra! A ${team.nome} restaurou a vida do castelo!`,
        );
      }
      // Arriscar tudo e acertar rende pontos extras (desempate + ranking).
      this.ganhar(team, WOR.BONUS_ARRISCAR, {
        rodada,
        fonte: 'ARRISCAR',
        descricao: `Rodada ${rodada}: ${aluno} arriscou a palavra inteira e acertou`,
      });
      // …e o aluno que acertou leva o bônus pessoal (029 §6A).
      this.ganharIndividual(team, alunoId, WOR.BONUS_ACERTO_PALAVRA, {
        rodada,
        fonte: 'ACERTO_PALAVRA',
        descricao: `Rodada ${rodada}: acertou a palavra inteira ao arriscar`,
      });
      // A onda acaba para todos: quem já fechou mantém o dano; as ações de
      // quem ainda não fechou são descartadas (029 #9).
      this.fecharRodada({ descartarAbertas: true, avancar: true });
      return;
    }

    this.registrar({
      alunoId,
      equipeId: team.id,
      tipo: 'ARRISCAR',
      acertou: false,
    });
    const tinhaHp = team.hp > 0;
    const caiu = team.aplicarDano(WOR.DANO_CRITICO);
    this.sujas.add(team.id);
    // Vira feed, não card: em paralelo isso acontece várias vezes por rodada.
    this.noFeed(
      'DANO_CRITICO',
      tinhaHp
        ? `${aluno} arriscou a palavra e errou! A ${team.nome} sofreu ${WOR.DANO_CRITICO} de dano.`
        : `${aluno} tentou a Invasão e errou!`,
    );
    if (caiu) this.queda(team);
    this.depoisDaAcao(team);
  }

  /**
   * Fecha a rodada por TEMPO esgotado (o telão dispara ao zerar). Devolve
   * `false` se o prazo ainda não venceu (margem para o relógio do cliente).
   */
  fecharPorTempo(): boolean {
    this.assertEmAndamento();
    const inicio = this.match.rodadaIniciadaEm
      ? Date.parse(this.match.rodadaIniciadaEm)
      : 0;
    if (inicio && this.agora - inicio < LIMITE_RODADA_MS - 2000) return false;
    this.fecharRodada({ porTempo: true });
    return true;
  }

  /** O mestre pula a palavra: a rodada em curso é descartada, sem resolver ninguém. */
  pularPalavra(): void {
    if (this.match.status !== 'EM_ANDAMENTO') return;
    this.limparRodada();
    this.avancarOnda();
  }

  /**
   * Linguagem imprópria no chat: o castelo da equipe perde HP (pode cair e virar
   * Horda). O alerta, com o nome do aluno, vai ao telão e à equipe infratora —
   * sem fan-out para as rivais, que não têm nada com a mensagem.
   */
  penalizarModeracao(alunoId: string): void {
    const team = this.equipeDoAluno(alunoId);
    const aluno = this.nomeMembro(team, alunoId);
    const tinhaHp = team.hp > 0;
    const caiu = tinhaHp && team.aplicarDano(WOR.PENALIDADE_HP);
    this.sujas.add(team.id);
    this.emitirCard(
      'MODERACAO',
      tinhaHp
        ? `⚠ ${aluno} usou linguagem imprópria no chat. −${WOR.PENALIDADE_HP} HP para ${team.nome}.`
        : `⚠ ${aluno} usou linguagem imprópria no chat.`,
      team.id,
    );
    if (caiu && this.match.status === 'EM_ANDAMENTO' && !this.fechou(team.id)) {
      this.marcarCaiu(team);
      if (this.todasFecharam()) this.fecharRodada({});
    }
  }

  // ===== Fechamentos =====

  /** Depois de uma ação: fecha a equipe completa e, se era a última, a rodada. */
  private depoisDaAcao(team: WorTeamEntity): void {
    if (
      !this.fechou(team.id) &&
      this.acoesDa(team.id).length >= team.membros.length
    ) {
      this.fecharEquipe(team);
    }
    if (this.match.status === 'EM_ANDAMENTO' && this.todasFecharam()) {
      this.fecharRodada({});
    }
  }

  /**
   * A equipe fecha a rodada: apura o voto entre quem acertou e, se for atacar,
   * aplica o dano NA HORA (200 se todos acertaram e a equipe tem ≥2 membros;
   * senão 100). Comprar dica só registra: a carta sai no fechamento da rodada.
   */
  private fecharEquipe(team: WorTeamEntity): void {
    const acoes = this.acoesDa(team.id);
    const acertadores = acoes.filter((a) => a.tipo === 'LETRA' && a.acertou);
    const ordem = this.match.equipesFechadas.length + 1;
    const res: ResultadoRodadaEquipe = {
      equipeId: team.id,
      equipeNome: team.nome,
      ordem,
      acertadores: this.acertadoresDe(team, acertadores),
      acao: 'NADA',
    };

    let alvoAtingido: {
      alvo: WorTeamEntity;
      dano: number;
      critico: boolean;
    } | null = null;
    if (!team.isHorde && acertadores.length) {
      const vencedor = this.apurarVoto(acertadores);
      if (vencedor.tipo === 'DICA') {
        res.acao = 'DICA';
      } else {
        const alvo = this.teams.find((t) => t.id === vencedor.alvoEquipeId);
        if (alvo) {
          const todosAcertaram =
            acoes.length === team.membros.length &&
            acoes.every((a) => a.tipo === 'LETRA' && a.acertou);
          const critico = todosAcertaram && team.membros.length >= 2;
          const dano = critico ? WOR.DANO_CRITICO : WOR.DANO_ATAQUE;
          res.acao = 'ATACAR';
          res.alvoEquipeId = alvo.id;
          res.alvoNome = alvo.nome;
          res.dano = dano;
          res.critico = critico;
          alvoAtingido = { alvo, dano, critico };
        }
      }
    }
    // A equipe entra na fila antes do efeito: se o ataque derrubar o alvo, ele
    // fecha DEPOIS dela.
    this.match.equipesFechadas = [
      ...this.match.equipesFechadas,
      { equipeId: team.id, ordem, resultado: res.acao },
    ];
    this.rodada.resultados = [...this.rodada.resultados, res];

    if (res.acao === 'DICA') {
      this.noFeed('DICA', `A ${team.nome} comprou uma dica.`);
      return;
    }
    if (!alvoAtingido) return;

    const { alvo, dano, critico } = alvoAtingido;
    const caiu = alvo.aplicarDano(dano);
    this.sujas.add(alvo.id);
    const n = acertadores.length;
    const quem = res.acertadores.map((a) => a.nome).join(', ');
    const rodada = this.numeroRodada();
    // O dano causado vira pontos da equipe atacante (desempate + ranking).
    this.ganhar(team, dano * WOR.PONTOS_POR_DANO, {
      rodada,
      fonte: critico ? 'CRITICO' : 'DANO',
      descricao: `Rodada ${rodada}: a equipe fechou em ${ordem}º, acertou ${n} ${n === 1 ? 'letra' : 'letras'} (${quem}) e ${critico ? 'deu um ataque crítico no' : 'atacou o'} castelo da ${alvo.nome}, ${dano} de dano`,
    });
    // O ataque é da EQUIPE: o dano nasce da votação, não de um aluno.
    this.noFeed(
      'ATAQUE',
      `A ${team.nome} fechou em ${ordem}º e causou ${dano} de dano${critico ? ' crítico' : ''} no castelo da ${alvo.nome}!`,
    );
    if (caiu) this.queda(alvo);
  }

  /** Um castelo caiu: card com freeze e, se a equipe não fechou, ela fecha como `CAIU`. */
  private queda(team: WorTeamEntity): void {
    this.emitirCard(
      'QUEDA',
      `O castelo da ${team.nome} caiu! A ${team.nome} agora é uma Horda.`,
    );
    if (!this.fechou(team.id)) this.marcarCaiu(team);
  }

  /**
   * A equipe que caiu antes de fechar perde o ataque pendente e não joga mais
   * nesta rodada (029 #2, #6). As letras que ela já chutou contam no reveal.
   */
  private marcarCaiu(team: WorTeamEntity): void {
    const ordem = this.match.equipesFechadas.length + 1;
    const acertadores = this.acoesDa(team.id).filter(
      (a) => a.tipo === 'LETRA' && a.acertou,
    );
    this.match.equipesFechadas = [
      ...this.match.equipesFechadas,
      { equipeId: team.id, ordem, resultado: 'CAIU' },
    ];
    this.rodada.resultados = [
      ...this.rodada.resultados,
      {
        equipeId: team.id,
        equipeNome: team.nome,
        ordem,
        acertadores: this.acertadoresDe(team, acertadores),
        acao: 'CAIU',
      },
    ];
  }

  /**
   * Fecha a rodada: as equipes abertas resolvem com o que tiverem (na ordem da
   * última ação), as letras entram na máscara, cada dica comprada revela uma
   * carta e o reveal sai no `resumoRodada`. Palavra completa (ou `avancar`)
   * acaba a onda; senão começa a próxima rodada.
   */
  private fecharRodada(opcoes: {
    porTempo?: boolean;
    descartarAbertas?: boolean;
    avancar?: boolean;
  }): void {
    if (!opcoes.descartarAbertas) {
      const ultima = (t: WorTeamEntity) =>
        Math.max(...this.acoesDa(t.id).map((a) => Date.parse(a.em)));
      const abertas = this.equipesAtivas()
        .filter((t) => !this.fechou(t.id) && this.acoesDa(t.id).length)
        .sort((a, b) => ultima(a) - ultima(b));
      for (const t of abertas) {
        // Uma anterior pode tê-la derrubado (aí ela já fechou como CAIU).
        if (!this.fechou(t.id)) this.fecharEquipe(t);
      }
    }

    const fechadas = new Set(this.match.equipesFechadas.map((f) => f.equipeId));
    const validas = this.rodada.acoes.filter((a) => fechadas.has(a.equipeId));
    // Bônus pessoal da letra certa: só agora, no reveal. Creditar na hora
    // diria, pelo doc da equipe, se a letra estava certa (029 #14).
    const rodada = this.numeroRodada();
    for (const a of validas) {
      if (a.tipo !== 'LETRA' || !a.acertou) continue;
      const team = this.teams.find((t) => t.id === a.equipeId);
      if (!team) continue;
      this.ganharIndividual(team, a.alunoId, WOR.BONUS_ACERTO_LETRA, {
        rodada,
        fonte: 'ACERTO_LETRA',
        descricao: `Rodada ${rodada}: acertou a letra ${a.letra}`,
      });
    }
    const letras = validas
      .filter((a) => a.tipo === 'LETRA' && a.letra)
      .map((a) => a.letra as string);
    const letrasTentadas = [
      ...new Set([...this.match.letrasTentadas, ...letras]),
    ];
    const mascara = WorMatchEntity.mascarar(
      this.palavra().palavra,
      this.reveladas(letrasTentadas),
    );

    // Cada equipe que comprou revela uma carta, até acabarem (029 #7).
    const compras = this.rodada.resultados.filter(
      (r) => r.acao === 'DICA',
    ).length;
    const dicas = this.palavra().dicas;
    const cartasVisiveis = dicas.slice(
      0,
      Math.min(dicas.length, this.match.cartasVisiveis.length + compras),
    );

    Object.assign(this.match, {
      letrasTentadas,
      mascara,
      cartasVisiveis,
      resumoRodada: {
        seq: (this.match.resumoRodada?.seq ?? 0) + 1,
        resultados: [...this.rodada.resultados].sort(
          (a, b) => a.ordem - b.ordem,
        ),
        porTempo: !!opcoes.porTempo,
      },
    });
    this.limparRodada();

    if (opcoes.avancar || WorMatchEntity.estaCompleta(mascara)) {
      this.avancarOnda();
    } else {
      this.novaRodada = true;
    }
  }

  /** Zera a rodada em curso (pública e privada). */
  private limparRodada(): void {
    Object.assign(this.match, {
      jaAgiram: [],
      equipesFechadas: [],
      feedRodada: [],
    });
    this.rodada = new WorRodadaPrivada();
  }

  /** Próxima onda (palavra) ou o encerramento da partida. */
  private avancarOnda(): void {
    const proximo = this.match.ondaIndex + 1;
    if (proximo >= this.jogo.palavras.length) {
      this.encerrar();
      return;
    }
    const palavra = this.jogo.palavras[proximo];
    Object.assign(this.match, {
      ondaIndex: proximo,
      mascara: WorMatchEntity.mascarar(palavra.palavra, new Set()),
      letrasTentadas: [],
      cartasVisiveis: palavra.dicas.slice(0, 1),
      totalCartas: palavra.dicas.length,
    });
    this.limparRodada();
    this.novaRodada = true;
  }

  /**
   * Encerra a partida: aplica o bônus de intactez (HP restante vira pontos),
   * elege o vencedor por MAIOR HP com DESEMPATE por pontos, e prepara o crédito
   * no ranking da sala (campeã ×1, demais ×0,5).
   */
  private encerrar(): void {
    const rodada = this.numeroRodada();
    for (const t of this.teams) {
      this.ganhar(t, t.hp * WOR.BONUS_HP_FATOR, {
        rodada,
        fonte: 'HP_FINAL',
        descricao: `Fim da batalha: castelo de pé com ${t.hp} de HP`,
      });
    }
    const vencedor = [...this.teams].sort(
      (a, b) => b.hp - a.hp || (b.pontos ?? 0) - (a.pontos ?? 0),
    )[0];

    const ganhos: Array<{ alunoId: string; pontos: number }> = [];
    for (const t of this.teams) {
      const ganho = this.ganhoDaEquipe(t, vencedor?.id);
      for (const m of t.membros) {
        const pontos = ganho + this.ganhoIndividual(t, m.alunoId);
        if (pontos > 0) ganhos.push({ alunoId: m.alunoId, pontos });
      }
    }
    const creditos = vencedor ? creditosDaPartida(this.match, ganhos) : [];

    this.limparRodada();
    Object.assign(this.match, {
      status: 'ENCERRADO',
      vencedorEquipeId: vencedor?.id ?? null,
      rodadaIniciadaEm: null,
      logPontuacao: this.montarLog(vencedor?.id, creditos, rodada),
    });
    this.novaRodada = false;
    if (this.match.turmaId && vencedor && valeRanking(this.match)) {
      this.creditoPendente = { turmaId: this.match.turmaId, creditos };
    }
  }

  // ===== Saída =====

  /** O que a transação grava: raiz inteira, equipes alteradas e a rodada privada. */
  mudancas(): MudancasWor {
    if (this.card) {
      const lga: LastGlobalAction = {
        seq: (this.match.lastGlobalAction?.seq ?? 0) + 1,
        tipo: this.card.tipo,
        mensagem: this.card.mensagens.join(' '),
        duracaoMs: WOR.FREEZE_MS,
        em: new Date(this.agora).toISOString(),
      };
      this.match.lastGlobalAction = lga;
      // Fan-out: o aluno só escuta o doc da própria equipe, então é lá que o
      // card precisa chegar.
      for (const t of this.teams) {
        if (this.card.soEquipe && t.id !== this.card.soEquipe) continue;
        t.lastGlobalAction = lga;
        this.sujas.add(t.id);
      }
    }
    if (this.match.status === 'EM_ANDAMENTO') {
      const freeze = this.card ? WOR.FREEZE_MS : 0;
      if (this.novaRodada) {
        // Com um card no ar, a rodada nova nasce 3s no FUTURO: o cronômetro do
        // cliente só corre quando o card sai de cena.
        this.match.rodadaIniciadaEm = new Date(
          this.agora + freeze,
        ).toISOString();
      } else if (freeze && this.match.rodadaIniciadaEm) {
        // A rodada em curso ganha os 3s que o card rouba dela.
        this.match.rodadaIniciadaEm = new Date(
          Date.parse(this.match.rodadaIniciadaEm) + freeze,
        ).toISOString();
      }
    }
    this.match.placar = this.placarDe();

    const equipes: Record<string, Partial<WorTeamEntity>> = {};
    for (const t of this.teams) {
      if (!this.sujas.has(t.id)) continue;
      const plain: Partial<WorTeamEntity> = { ...t };
      delete plain.id;
      equipes[t.id] = plain;
    }
    const raiz: Partial<WorMatchEntity> = { ...this.match };
    delete raiz.id;
    return { raiz, equipes, rodada: this.rodada };
  }

  // ===== Regras auxiliares =====

  private assertEmAndamento(): void {
    if (this.match.status !== 'EM_ANDAMENTO') {
      throw new BadRequestException('A partida não está em andamento.');
    }
  }

  private assertPodeAgir(team: WorTeamEntity, alunoId: string): void {
    if (this.match.jaAgiram.includes(alunoId)) {
      throw new BadRequestException('Você já jogou nesta rodada.');
    }
    if (this.fechou(team.id)) {
      throw new BadRequestException({
        code: 'EQUIPE_FECHOU',
        message: 'Sua equipe já fechou esta rodada. Aguarde as outras equipes.',
      });
    }
  }

  private equipeDoAluno(alunoId: string): WorTeamEntity {
    const team = this.teams.find((t) =>
      t.membros.some((m) => m.alunoId === alunoId),
    );
    if (!team)
      throw new BadRequestException('Você não está em nenhuma equipe.');
    return team;
  }

  private palavra(): PalavraWor {
    const p = this.jogo.palavras[this.match.ondaIndex];
    if (!p) throw new NotFoundException('Palavra da onda não encontrada.');
    return p;
  }

  /** Letras dadas que EXISTEM na palavra (para montar a máscara). */
  private reveladas(letras: string[]): Set<string> {
    const naPalavra = new Set(
      [...this.palavra().palavra].map((c) => WorMatchEntity.normalizar(c)),
    );
    return new Set(letras.filter((l) => naPalavra.has(l)));
  }

  private registrar(acao: Omit<AcaoMembro, 'ordem' | 'em'>): void {
    this.rodada.acoes = [
      ...this.rodada.acoes,
      {
        ...acao,
        ordem: this.rodada.acoes.length,
        em: new Date(this.agora).toISOString(),
      },
    ];
    this.match.jaAgiram = [...this.match.jaAgiram, acao.alunoId];
  }

  private acoesDa(equipeId: string): AcaoMembro[] {
    return this.rodada.acoes.filter((a) => a.equipeId === equipeId);
  }

  private fechou(equipeId: string): boolean {
    return this.match.equipesFechadas.some((f) => f.equipeId === equipeId);
  }

  /** Equipes que jogam (uma equipe sem membros nunca fecharia a rodada). */
  private equipesAtivas(): WorTeamEntity[] {
    return this.teams.filter((t) => t.membros.length > 0);
  }

  private todasFecharam(): boolean {
    return this.equipesAtivas().every((t) => this.fechou(t.id));
  }

  /** Número da rodada em curso (1-based) para o log. */
  private numeroRodada(): number {
    return (this.match.resumoRodada?.seq ?? 0) + 1;
  }

  private nomeMembro(team: WorTeamEntity, alunoId: string): string {
    return team.membros.find((m) => m.alunoId === alunoId)?.nome ?? 'Aluno';
  }

  private acertadoresDe(
    team: WorTeamEntity,
    acoes: AcaoMembro[],
  ): { nome: string; letra: string }[] {
    return acoes.map((a) => ({
      nome: this.nomeMembro(team, a.alunoId),
      letra: a.letra as string,
    }));
  }

  /** Valida o voto (atacar exige um rival existente e diferente da própria equipe). */
  private montarVoto(
    team: WorTeamEntity,
    acao: VotoAcao,
    alvoEquipeId?: string,
  ): VotoRodada {
    if (acao === 'DICA') return { tipo: 'DICA' };
    if (!alvoEquipeId || alvoEquipeId === team.id) {
      throw new BadRequestException('Escolha um castelo rival para atacar.');
    }
    if (!this.teams.some((t) => t.id === alvoEquipeId)) {
      throw new NotFoundException('Equipe alvo não encontrada.');
    }
    return { tipo: 'ATACAR', alvoEquipeId };
  }

  /**
   * Valida o efeito escolhido para o Risco Heroico. Devolve o castelo alvo da
   * Catapulta, ou `null` quando o efeito é Recuperar HP (o padrão). A Horda não
   * escolhe — acertar, para ela, é sempre a Usurpação.
   */
  private alvoDaCatapulta(
    team: WorTeamEntity,
    opcoes: { efeito?: EfeitoRisco; alvoEquipeId?: string },
  ): WorTeamEntity | null {
    if (team.isHorde || opcoes.efeito !== 'CATAPULTA') return null;
    const alvo = this.teams.find((t) => t.id === opcoes.alvoEquipeId);
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
   * que vira a nova Horda. Sem líder (todos hordas), reergue o próprio com HP
   * cheio. Devolve o líder deposto (para narrar o card).
   */
  private usurpar(invasora: WorTeamEntity): WorTeamEntity | null {
    const lider = this.teams
      .filter((t) => t.id !== invasora.id && !t.isHorde && t.hp > 0)
      .sort((a, b) => b.hp - a.hp)[0];
    this.sujas.add(invasora.id);
    if (!lider) {
      invasora.hp = WOR.HP_INICIAL;
      invasora.isHorde = false;
      return null;
    }
    invasora.hp = lider.hp;
    invasora.isHorde = false;
    lider.hp = 0;
    lider.isHorde = true;
    this.sujas.add(lider.id);
    return lider;
  }

  /** Card com freeze. Dois no mesmo comando viram um só, com as duas falas. */
  private emitirCard(
    tipo: TipoAcaoGlobal,
    mensagem: string,
    soEquipe?: string,
  ): void {
    if (!this.card) {
      this.card = { tipo, mensagens: [mensagem], soEquipe };
      return;
    }
    this.card.mensagens.push(mensagem);
    if (this.card.soEquipe !== soEquipe) this.card.soEquipe = undefined;
  }

  /** Evento sem freeze (029 §3). */
  private noFeed(
    tipo: 'ATAQUE' | 'DICA' | 'DANO_CRITICO',
    mensagem: string,
  ): void {
    const seq = (this.match.feedSeq ?? 0) + 1;
    this.match.feedSeq = seq;
    this.match.feedRodada = [
      ...this.match.feedRodada,
      { seq, tipo, mensagem, em: new Date(this.agora).toISOString() },
    ];
  }

  /**
   * Soma à equipe os pontos (com o multiplicador da partida) e registra o item
   * no log dela (spec 027 §1.3).
   */
  private ganhar(
    team: WorTeamEntity,
    base: number,
    item: Omit<ItemLogPontos, 'pontos'>,
  ): void {
    const pontos = this.pontos(base);
    team.pontos = (team.pontos ?? 0) + pontos;
    this.anotar(team.logPontos, item, pontos, (l) => (team.logPontos = l));
    this.sujas.add(team.id);
  }

  /**
   * O bônus pessoal (029 §6A): com o multiplicador, no `pontosIndividuais` e
   * no log do aluno — nunca no `team.pontos`, que é dividido com a equipe.
   */
  private ganharIndividual(
    team: WorTeamEntity,
    alunoId: string,
    base: number,
    item: Omit<ItemLogPontos, 'pontos'>,
  ): void {
    const pontos = this.pontos(base);
    const individuais = { ...(team.pontosIndividuais ?? {}) };
    individuais[alunoId] = (individuais[alunoId] ?? 0) + pontos;
    team.pontosIndividuais = individuais;
    const logs = { ...(team.logIndividual ?? {}) };
    this.anotar(logs[alunoId], item, pontos, (l) => (logs[alunoId] = l));
    team.logIndividual = logs;
    this.sujas.add(team.id);
  }

  /** Acrescenta o item ao log (o multiplicador vai na descrição acima de 1x). */
  private anotar(
    log: ItemLogPontos[] | undefined,
    item: Omit<ItemLogPontos, 'pontos'>,
    pontos: number,
    gravar: (log: ItemLogPontos[]) => void,
  ): void {
    if (pontos === 0) return;
    const mult = this.match.multiplicador ?? 1;
    gravar([
      ...(log ?? []),
      {
        ...item,
        descricao: mult > 1 ? `${item.descricao} (×${mult})` : item.descricao,
        pontos,
      },
    ]);
  }

  /** Os pontos já com o multiplicador da partida (partida antiga = 1x). */
  private pontos(base: number): number {
    return Math.round(base * (this.match.multiplicador ?? 1));
  }

  /** Bônus pessoal → XP do ranking, inteiro (sem o ×0,5 da não campeã). */
  private ganhoIndividual(team: WorTeamEntity, alunoId: string): number {
    return Math.round(
      (team.pontosIndividuais?.[alunoId] ?? 0) * WOR.XP_POR_PONTO,
    );
  }

  /** Pontos da equipe → XP do ranking (campeã ×1, demais ×0,5). */
  private ganhoDaEquipe(team: WorTeamEntity, vencedorId?: string): number {
    const fator = team.id === vencedorId ? 1 : 0.5;
    return Math.round((team.pontos ?? 0) * WOR.XP_POR_PONTO * fator);
  }

  /**
   * O log de cada aluno (spec 027 §1.3): os pontos são da equipe, então todo
   * membro recebe os mesmos itens. A não campeã ganha o item do fator ×0,5,
   * para a soma bater com o crédito real. Depois vêm os itens do bônus pessoal
   * de cada aluno (029 §6A), que não sofrem o fator.
   */
  private montarLog(
    vencedorId: string | undefined,
    creditos: Array<{ alunoId: string; pontos: number }>,
    rodada: number,
  ): LogPontuacaoJogador[] {
    return this.teams.flatMap((t) => {
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
        totalPartida: total + (t.pontosIndividuais?.[m.alunoId] ?? 0),
        creditoRanking: creditoDe(creditos, m.alunoId),
        itens: [...itens, ...(t.logIndividual?.[m.alunoId] ?? [])],
      }));
    });
  }

  /** Snapshot das equipes para a raiz (o aluno lê os castelos rivais barato). */
  private placarDe(): PlacarEquipe[] {
    return this.teams.map((t) => ({
      id: t.id,
      nome: t.nome,
      cor: t.cor,
      hp: t.hp,
      isHorde: t.isHorde,
      pontos: t.pontos ?? 0,
    }));
  }
}
