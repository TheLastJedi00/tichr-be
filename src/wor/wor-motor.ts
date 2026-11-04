import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  creditoDe,
  creditosDaPartida,
  ItemLogPontos,
  LogPontuacaoJogador,
} from '../common/log-pontuacao';
import {
  ehOcioso,
  limiteOciosidade,
  marcarNoLog,
  registrarFaltas,
} from '../common/ociosidade';
import { valeRanking } from '../common/vale-ranking';
import { MudancasWor } from './wor-match.repository';
import {
  AcaoMembro,
  ItemFeed,
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
 * Motor da rodada do Tichr Wor. Desde a 029 não há turno: todas as equipes
 * jogam a mesma palavra no mesmo relógio. Cada membro age uma vez (chuta letra
 * + vota, ou arrisca a palavra — uma vez por equipe por rodada). Desde a 032
 * nada acontece durante a rodada: a equipe só "fecha" (todos agiram), e a
 * RODADA fecha quando todas fecharam ou o tempo acaba. Aí tudo é resolvido de
 * uma vez (resolução simultânea): dano, Catapulta, cura, Usurpação, letras e
 * dicas.
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
   * Risco Heroico / Invasão: um membro tenta a palavra inteira, uma vez por
   * equipe por rodada (032 #13). Só REGISTRA: o efeito (Catapulta, Recuperar HP
   * ou Usurpação no acerto; Dano Crítico no próprio castelo no erro) sai no
   * fechamento da rodada, junto com o resto (032 #11, #14, #15). Acertar não
   * encerra mais a onda na hora: ela avança depois do fechamento.
   */
  arriscar(
    alunoId: string,
    palpite: string,
    opcoes: { efeito?: EfeitoRisco; alvoEquipeId?: string } = {},
  ): void {
    this.assertEmAndamento();
    const team = this.equipeDoAluno(alunoId);
    this.assertPodeAgir(team, alunoId);
    if (team.arriscouNaRodada) {
      throw new ConflictException({
        code: 'ARRISCAR_USADO',
        message: 'Arriscar já foi usado nesta rodada pela sua equipe.',
      });
    }
    // Antes de conferir a palavra: um envio malformado não pode queimar a
    // tentativa — nem revelar se o palpite estava certo.
    const catapultaEm = this.alvoDaCatapulta(team, opcoes);

    const { palavra } = this.palavra();
    const acertou =
      WorMatchEntity.normalizar(palpite.trim()) ===
      WorMatchEntity.normalizar(palavra.trim());
    // Sem `undefined` no objeto: o Firestore recusa.
    const efeito: Pick<AcaoMembro, 'efeito' | 'alvoEquipeId'> = team.isHorde
      ? {}
      : catapultaEm
        ? { efeito: 'CATAPULTA', alvoEquipeId: catapultaEm.id }
        : { efeito: 'CURA' };
    this.registrar({
      alunoId,
      equipeId: team.id,
      tipo: 'ARRISCAR',
      acertou,
      ...efeito,
    });
    // Público na própria equipe (trava o botão dos colegas), sem dizer se acertou.
    team.arriscouNaRodada = alunoId;
    this.sujas.add(team.id);
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
   * sem fan-out para as rivais, que não têm nada com a mensagem. É a única
   * perda de HP fora do fechamento (é punição, não jogada).
   */
  penalizarModeracao(alunoId: string): void {
    const team = this.equipeDoAluno(alunoId);
    const aluno = this.nomeMembro(team, alunoId);
    const tinhaHp = team.hp > 0;
    if (tinhaHp) team.aplicarDano(WOR.PENALIDADE_HP);
    this.sujas.add(team.id);
    this.emitirCard(
      'MODERACAO',
      tinhaHp
        ? `⚠ ${aluno} usou linguagem imprópria no chat. −${WOR.PENALIDADE_HP} HP para ${team.nome}.`
        : `⚠ ${aluno} usou linguagem imprópria no chat.`,
      team.id,
    );
  }

  // ===== Fechamentos =====

  /** Depois de uma ação: fecha a equipe completa e, se era a última, a rodada. */
  private depoisDaAcao(team: WorTeamEntity): void {
    if (!this.fechou(team.id) && this.pendentesDa(team).length === 0) {
      this.fecharEquipe(team);
    }
    if (
      this.match.status === 'EM_ANDAMENTO' &&
      (this.todasFecharam() || this.soFaltamOciosos())
    ) {
      this.fecharRodada({});
    }
  }

  /**
   * Os únicos que ainda não jogaram já estão marcados como ociosos (032 #10):
   * a rodada fecha sem esperar o tempo, para o ocioso não segurar a turma.
   */
  private soFaltamOciosos(): boolean {
    const limite = limiteOciosidade(this.match, 'WOR');
    const pendentes = this.equipesAtivas()
      .filter((t) => !this.fechou(t.id))
      .flatMap((t) => this.pendentesDa(t));
    return (
      pendentes.length > 0 &&
      pendentes.every((id) => ehOcioso(this.match.ociosidade, id, limite))
    );
  }

  /**
   * Faltas da rodada que fecha (032 §3.2): todo membro de equipe ativa que tinha
   * ação e não agiu. Na Horda, depois do arriscar ninguém mais tinha ação.
   */
  private registrarFaltasDaRodada(hordaAntes: Map<string, boolean>): void {
    const esperados = this.equipesAtivas()
      .filter((t) => !(hordaAntes.get(t.id) && t.arriscouNaRodada))
      .flatMap((t) => t.membros.map((m) => m.alunoId));
    this.match.ociosidade = registrarFaltas(
      this.match.ociosidade,
      esperados,
      this.match.jaAgiram,
    );
  }

  /**
   * Membros que ainda têm ação na rodada. Na Horda a única ação é arriscar, e
   * ela vale uma vez por equipe: depois dela não sobra nada a ninguém.
   */
  private pendentesDa(team: WorTeamEntity): string[] {
    if (team.isHorde && team.arriscouNaRodada) return [];
    return team.membros
      .map((m) => m.alunoId)
      .filter((id) => !this.match.jaAgiram.includes(id));
  }

  /**
   * A equipe terminou de jogar (032): entra na fila de chegada, sem efeito. O
   * lado público diz só `JOGOU` — o que ela fez aparece no fechamento.
   */
  private fecharEquipe(team: WorTeamEntity): void {
    this.match.equipesFechadas = [
      ...this.match.equipesFechadas,
      {
        equipeId: team.id,
        ordem: this.match.equipesFechadas.length + 1,
        resultado: 'JOGOU',
      },
    ];
    this.noFeed('JOGOU', `A ${team.nome} já jogou.`);
  }

  /**
   * Fecha a rodada (032 §2.1). Tudo é calculado sobre o HP do INÍCIO do
   * fechamento e aplicado de uma vez: um castelo que cai nesta rodada ainda dá o
   * golpe dela, e cura e dano no mesmo castelo somam. A ordem de chegada só
   * desempata: decide quem leva os pontos quando os golpes passam do HP do alvo,
   * e a ordem do reveal. Depois vêm as Usurpações, as letras e as dicas. Palavra
   * completa ou acertada ao arriscar acaba a onda; senão começa a próxima rodada.
   */
  private fecharRodada(opcoes: { porTempo?: boolean }): void {
    const rodada = this.numeroRodada();
    const chegada = this.ordemDeChegada();
    const hordaAntes = new Map(this.teams.map((t) => [t.id, t.isHorde]));

    type Golpe = {
      de: WorTeamEntity;
      alvo: WorTeamEntity;
      dano: number;
      tipo: 'DANO' | 'CRITICO' | 'CATAPULTA' | 'PROPRIO';
      res: ResultadoRodadaEquipe;
      aluno?: string;
    };
    const golpes: Golpe[] = [];
    const curas = new Map<string, number>();
    const usurpadoras: Array<{
      team: WorTeamEntity;
      res: ResultadoRodadaEquipe;
      aluno: string;
    }> = [];
    const resultados: ResultadoRodadaEquipe[] = [];
    let palavraAcertada = false;

    chegada.forEach((team, i) => {
      const acoes = this.acoesDa(team.id);
      const acertadores = acoes.filter((a) => a.tipo === 'LETRA' && a.acertou);
      const res: ResultadoRodadaEquipe = {
        equipeId: team.id,
        equipeNome: team.nome,
        ordem: i + 1,
        acertadores: this.acertadoresDe(team, acertadores),
        acao: 'NADA',
        hpAntes: team.hp,
      };

      if (!hordaAntes.get(team.id) && acertadores.length) {
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
            res.acao = 'ATACAR';
            res.alvoEquipeId = alvo.id;
            res.alvoNome = alvo.nome;
            res.critico = critico;
            golpes.push({
              de: team,
              alvo,
              dano: critico ? WOR.DANO_CRITICO : WOR.DANO_ATAQUE,
              tipo: critico ? 'CRITICO' : 'DANO',
              res,
            });
          }
        }
      }

      const arr = acoes.find((a) => a.tipo === 'ARRISCAR');
      if (arr) {
        const aluno = this.nomeMembro(team, arr.alunoId);
        res.arriscar = { nome: aluno, acertou: arr.acertou };
        if (arr.acertou) {
          palavraAcertada = true;
          // Arriscar tudo e acertar rende pontos extras (desempate + ranking)…
          this.ganhar(team, WOR.BONUS_ARRISCAR, {
            rodada,
            fonte: 'ARRISCAR',
            descricao: `Rodada ${rodada}: ${aluno} arriscou a palavra inteira e acertou`,
          });
          // …e o aluno que acertou leva o bônus pessoal (029 §6A).
          this.ganharIndividual(team, arr.alunoId, WOR.BONUS_ACERTO_PALAVRA, {
            rodada,
            fonte: 'ACERTO_PALAVRA',
            descricao: `Rodada ${rodada}: acertou a palavra inteira ao arriscar`,
          });
          const alvo = this.teams.find((t) => t.id === arr.alvoEquipeId);
          if (hordaAntes.get(team.id)) {
            res.arriscar.efeito = 'USURPACAO';
            usurpadoras.push({ team, res, aluno });
          } else if (arr.efeito === 'CATAPULTA' && alvo) {
            res.arriscar.efeito = 'CATAPULTA';
            res.arriscar.alvoEquipeId = alvo.id;
            res.arriscar.alvoNome = alvo.nome;
            golpes.push({
              de: team,
              alvo,
              dano: WOR.DANO_CATAPULTA,
              tipo: 'CATAPULTA',
              res,
              aluno,
            });
          } else {
            res.arriscar.efeito = 'CURA';
            curas.set(team.id, (curas.get(team.id) ?? 0) + WOR.CURA_MASSIVA);
          }
        } else if (team.hp > 0) {
          golpes.push({
            de: team,
            alvo: team,
            dano: WOR.DANO_CRITICO,
            tipo: 'PROPRIO',
            res,
          });
        }
      }
      resultados.push(res);
    });

    // Simultâneo: o "HP disponível" de cada castelo é o do início + a cura da
    // rodada. Os golpes o consomem na ordem de chegada só para dizer quanto de
    // cada um de fato saiu (é isso que vira ponto).
    const restante = new Map(
      this.teams.map((t) => [t.id, t.hp + (curas.get(t.id) ?? 0)]),
    );
    for (const g of golpes) {
      const antes = restante.get(g.alvo.id) ?? 0;
      const efetivo = Math.min(g.dano, Math.max(0, antes));
      restante.set(g.alvo.id, antes - g.dano);
      if (g.tipo === 'PROPRIO') continue;
      if (g.tipo === 'CATAPULTA') {
        g.res.arriscar!.dano = efetivo;
        this.ganhar(g.de, efetivo * WOR.PONTOS_POR_DANO, {
          rodada,
          fonte: 'CATAPULTA',
          descricao: `Rodada ${rodada}: ${g.aluno} disparou a Catapulta no castelo da ${g.alvo.nome}, ${efetivo} de dano`,
        });
        continue;
      }
      g.res.dano = efetivo;
      const n = g.res.acertadores.length;
      const quem = g.res.acertadores.map((a) => a.nome).join(', ');
      // O dano causado vira pontos da equipe atacante (desempate + ranking).
      this.ganhar(g.de, efetivo * WOR.PONTOS_POR_DANO, {
        rodada,
        fonte: g.tipo,
        descricao: `Rodada ${rodada}: a equipe chegou em ${g.res.ordem}º, acertou ${n} ${n === 1 ? 'letra' : 'letras'} (${quem}) e ${g.tipo === 'CRITICO' ? 'deu um ataque crítico no' : 'atacou o'} castelo da ${g.alvo.nome}, ${efetivo} de dano`,
      });
    }

    const quedas: WorTeamEntity[] = [];
    for (const t of this.teams) {
      const novo = Math.max(
        0,
        Math.min(WOR.HP_INICIAL, restante.get(t.id) ?? t.hp),
      );
      if (novo === t.hp) continue;
      t.hp = novo;
      if (novo === 0 && !t.isHorde) {
        t.isHorde = true;
        quedas.push(t);
      }
      this.sujas.add(t.id);
    }

    // Usurpação depois dos danos: a Horda toma o castelo de maior HP de AGORA.
    for (const { team, res, aluno } of usurpadoras) {
      const lider = this.usurpar(team);
      res.arriscar!.alvoNome = lider?.nome;
      this.emitirCard(
        'USURPACAO',
        lider
          ? `A Horda de ${aluno} acertou a palavra e ROUBOU o castelo da ${lider.nome}!`
          : `A Horda de ${aluno} acertou a palavra e reergueu o próprio castelo!`,
      );
    }

    for (const res of resultados) {
      const t = this.teams.find((x) => x.id === res.equipeId)!;
      res.hpDepois = t.hp;
      if (quedas.includes(t)) res.caiu = true;
      const a = res.arriscar;
      if (a?.acertou && a.efeito === 'CATAPULTA') {
        const caiu = quedas.some((q) => q.id === a.alvoEquipeId);
        this.emitirCard(
          'CATAPULTA',
          `${a.nome} acertou a palavra e disparou a Catapulta! O castelo da ${a.alvoNome} sofreu ${a.dano ?? 0} de dano${caiu ? ' e caiu' : ''}!`,
        );
      } else if (a?.acertou && a.efeito === 'CURA') {
        this.emitirCard(
          'CURA',
          `${a.nome} arriscou tudo e acertou a palavra! A ${res.equipeNome} restaurou a vida do castelo!`,
        );
      }
    }
    for (const t of quedas) {
      this.emitirCard(
        'QUEDA',
        `O castelo da ${t.nome} caiu! A ${t.nome} agora é uma Horda.`,
      );
    }

    // Bônus pessoal da letra certa: só agora, no reveal. Creditar na hora
    // diria, pelo doc da equipe, se a letra estava certa (029 #14).
    for (const a of this.rodada.acoes) {
      if (a.tipo !== 'LETRA' || !a.acertou) continue;
      const team = this.teams.find((t) => t.id === a.equipeId);
      if (!team) continue;
      this.ganharIndividual(team, a.alunoId, WOR.BONUS_ACERTO_LETRA, {
        rodada,
        fonte: 'ACERTO_LETRA',
        descricao: `Rodada ${rodada}: acertou a letra ${a.letra}`,
      });
    }
    const letras = this.rodada.acoes
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
    const compras = resultados.filter((r) => r.acao === 'DICA').length;
    const dicas = this.palavra().dicas;
    const cartasVisiveis = dicas.slice(
      0,
      Math.min(dicas.length, this.match.cartasVisiveis.length + compras),
    );

    this.registrarFaltasDaRodada(hordaAntes);
    Object.assign(this.match, {
      letrasTentadas,
      mascara,
      cartasVisiveis,
      resumoRodada: {
        seq: (this.match.resumoRodada?.seq ?? 0) + 1,
        resultados,
        porTempo: !!opcoes.porTempo,
      },
    });
    this.limparRodada();

    if (palavraAcertada || WorMatchEntity.estaCompleta(mascara)) {
      this.avancarOnda();
    } else {
      this.novaRodada = true;
    }
  }

  /**
   * Ordem de chegada da rodada: as equipes que fecharam, na ordem em que
   * fecharam, e depois as que ficaram abertas com alguma ação, pela última ação.
   */
  private ordemDeChegada(): WorTeamEntity[] {
    const fechadas = this.match.equipesFechadas
      .map((f) => this.teams.find((t) => t.id === f.equipeId))
      .filter((t): t is WorTeamEntity => !!t);
    const ultima = (t: WorTeamEntity) =>
      Math.max(...this.acoesDa(t.id).map((a) => Date.parse(a.em)));
    const abertas = this.equipesAtivas()
      .filter((t) => !this.fechou(t.id) && this.acoesDa(t.id).length)
      .sort((a, b) => ultima(a) - ultima(b));
    return [...fechadas, ...abertas];
  }
  /** Zera a rodada em curso (pública e privada). */
  private limparRodada(): void {
    Object.assign(this.match, {
      jaAgiram: [],
      equipesFechadas: [],
      feedRodada: [],
    });
    this.rodada = new WorRodadaPrivada();
    // A trava do arriscar é por rodada (032 #13): nada acumula.
    for (const t of this.teams) {
      if (!t.arriscouNaRodada) continue;
      t.arriscouNaRodada = null;
      this.sujas.add(t.id);
    }
  }

  /** Próxima onda (palavra) ou o encerramento da partida. */
  private avancarOnda(): void {
    const proximo = this.match.ondaIndex + 1;
    if (proximo >= this.jogo.ondas.length) {
      this.encerrar();
      return;
    }
    const palavra = this.jogo.ondas[proximo];
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
      logPontuacao: marcarNoLog(
        this.montarLog(vencedor?.id, creditos, rodada),
        (alunoId) => this.match.ociosidade?.[alunoId] ?? 0,
        limiteOciosidade(this.match, 'WOR'),
      ),
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
    const p = this.jogo.ondas[this.match.ondaIndex];
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
  private noFeed(tipo: ItemFeed['tipo'], mensagem: string): void {
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
