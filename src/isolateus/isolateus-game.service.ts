import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { embaralhar } from '../common/shuffle.util';
import { XpService } from '../turma/xp.service';
import { AcaoAmeacaDto } from './dto/acao-ameaca.dto';
import { PoderAlienigena, UsarPoderDto } from './dto/usar-poder.dto';
import {
  Acontecimento,
  AlertaRodada,
  Habitante,
  ISOLATEUS,
  IsolateusMatchEntity,
  ResumoRodada,
  Rumor,
  Setor,
  StatusIsolateus,
  TipoAcontecimento,
} from './entities/isolateus-match.entity';
import {
  AcaoAmeaca,
  IsolateusSegredoEntity,
} from './entities/isolateus-segredo.entity';
import { IsolateusJogoRepository } from './isolateus-jogo.repository';
import { IsolateusMatchRepository } from './isolateus-match.repository';
import {
  SETOR_COMUNICACAO,
  SETOR_IDS,
  saoVizinhos,
  vizinhosDe,
} from './isolateus.data';

/** O que o aluno recebe sobre si mesmo — por REST, jamais pelo snapshot. */
export interface PainelHabitante {
  papel: 'ALDEAO' | 'AMEACA';
  habitanteId: string;
  vivo: boolean;
  preso: boolean;
  /**
   * Onde ELE está agora. Durante a noite, é o destino guardado no cofre — o doc
   * público só recebe as posições no fechamento.
   */
  setorId: string;

  // ===== Só para a Ameaça =====
  /** Codinomes das outras Ameaças livres (para não se abduzirem nem acusarem). */
  aliados?: string[];
  /** O poder ganho no acerto e o que ela pode escolher; `null` = sem poder. */
  poder?: Record<PoderAlienigena, boolean> | null;
  /** O habitante sob Controle Mental nesta rodada, se houver. */
  controle?: { habitanteId: string; nome: string } | null;
  /** Quem está AGORA no setor de onde ela age (o dela ou o do controlado). */
  fileira?: { setorId: string; habitantes: Array<{ id: string; nome: string }> };
}

/**
 * O motor da invasão: turno da Ameaça, defesa da vila, Sinal Interceptado,
 * Quarentena e o veredito.
 *
 * Regra de ouro (§11.3): tudo que é oculto — quem é a Ameaça, quais habitantes
 * são NPCs, a alternativa correta da questão no ar — é processado **aqui** e
 * nunca escrito na camada pública. O que sai daqui para o Firestore é só o que
 * a vila inteira pode ver.
 */
@Injectable()
export class IsolateusGameService {
  constructor(
    private readonly matches: IsolateusMatchRepository,
    private readonly jogos: IsolateusJogoRepository,
    private readonly xp: XpService,
  ) {}

  /** Carrega a partida e o cofre juntos (nunca se usa um sem o outro). */
  private async carregar(
    partidaId: string,
  ): Promise<{ partida: IsolateusMatchEntity; segredo: IsolateusSegredoEntity }> {
    const partida = await this.matches.buscar(partidaId);
    const segredo = await this.matches.buscarSegredo(partidaId);
    if (!partida || !segredo) {
      throw new NotFoundException('Partida nao encontrada.');
    }
    return { partida, segredo };
  }

  /**
   * A questão em jogo. Indexada por `questaoIndex`, **não** pela noite: o banco
   * só é consumido quando há disputa (abdução a repelir ou reparo a fazer), e
   * uma noite de pura sabotagem não gasta pergunta nenhuma.
   */
  private async questaoDaRodada(partida: IsolateusMatchEntity) {
    const jogo = await this.jogos.findById(partida.jogoId);
    return jogo?.questoes[partida.questaoIndex];
  }

  /** O habitante do aluno; lança se ele não está nesta partida. */
  private habitanteDoAluno(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
    alunoId: string,
  ) {
    const habitanteId = segredo.habitanteDe(alunoId);
    const habitante = partida.habitantes.find((h) => h.id === habitanteId);
    if (!habitante) {
      throw new ForbiddenException('Você não é um habitante desta vila.');
    }
    return habitante;
  }

  /**
   * A Revelação de papéis e a visão privilegiada da Ameaça. É a única porta por
   * onde o segredo sai do servidor — autenticada e recortada por aluno: o
   * Aldeão recebe apenas o próprio papel, e nada sobre os outros.
   */
  async painel(alunoId: string, partidaId: string): Promise<PainelHabitante> {
    const { partida, segredo } = await this.carregar(partidaId);
    const habitante = this.habitanteDoAluno(partida, segredo, alunoId);

    // O gabarito NÃO sai mais por aqui: com o poder condicionado ao acerto,
    // entregá-lo à Ameaça daria um poder de graça em toda questão.
    const base: PainelHabitante = {
      papel: segredo.ehAmeaca(alunoId) ? 'AMEACA' : 'ALDEAO',
      habitanteId: habitante.id,
      vivo: habitante.vivo,
      preso: habitante.preso,
      setorId: this.posicaoDe(segredo, habitante),
    };
    if (base.papel !== 'AMEACA') return base;

    // A visão da Ameaça. É também o ÚNICO canal do papel de quem foi
    // contagiado: o celular faz polling daqui, e o doc público não muda.
    const temPoder = segredo.poderes?.some((p) => p.alunoId === alunoId);
    const origem = this.origemDaAmeaca(partida, segredo, alunoId);
    return {
      ...base,
      aliados: segredo
        .ameacasIds()
        .filter((a) => a !== alunoId)
        .map((a) => partida.habitantes.find((h) => h.id === segredo.habitanteDe(a)))
        .filter((h): h is Habitante => !!h && h.vivo && !h.preso)
        .map((h) => h.nome),
      poder: temPoder
        ? {
            CONTROLE: true,
            CONTAGIO:
              alunoId === segredo.alienAlunoId &&
              this.alvosDeContagio(partida, segredo).length > 0,
            DELIRIO: true,
          }
        : null,
      controle: origem.controlado
        ? { habitanteId: origem.controlado.id, nome: origem.controlado.nome }
        : null,
      fileira: {
        setorId: origem.setorId,
        habitantes: partida.vivos
          .filter(
            (h) =>
              h.id !== habitante.id &&
              this.posicaoDe(segredo, h) === origem.setorId,
          )
          .map((h) => ({ id: h.id, nome: h.nome })),
      },
    };
  }

  /**
   * De onde a Ameaça age agora: o próprio setor, ou — sob Controle Mental
   * ativo nesta rodada — o setor do habitante controlado.
   */
  private origemDaAmeaca(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
    alunoId: string,
  ): { setorId: string; controlado: Habitante | null } {
    const controle = segredo.controles?.find(
      (c) => c.ameacaAlunoId === alunoId && c.rodada === partida.rodada,
    );
    const controlado = controle
      ? (partida.vivos.find((h) => h.id === controle.habitanteId) ?? null)
      : null;
    if (controlado) {
      return { setorId: this.posicaoDe(segredo, controlado), controlado };
    }
    const propria = this.habitanteDoAluno(partida, segredo, alunoId);
    return { setorId: this.posicaoDe(segredo, propria), controlado: null };
  }

  /** Aldeões reais, na vila, que ainda podem ser contagiados. */
  private alvosDeContagio(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): string[] {
    return this.reaisNaVila(partida, segredo)
      .map((v) => v.alunoId)
      .filter((a) => !segredo.ehAmeaca(a));
  }

  // ===== O Diário da Vila =====

  /**
   * Acrescenta um evento ao Diário. **Não persiste sozinho**: devolve a lista
   * nova para entrar no mesmo `commitPartida` da mudança que o gerou — evento e
   * estado precisam chegar juntos no snapshot, senão o cliente pisca um card
   * anunciando algo que o mapa ainda não reflete.
   */
  private registrar(
    partida: IsolateusMatchEntity,
    tipo: TipoAcontecimento,
    texto: string,
    /**
     * Noite do evento, quando ela ainda não é a de `partida.rodada`. O caso é a
     * queda da noite: o evento é registrado enquanto se monta o `dados` da
     * virada, antes de o `rodada` novo ser aplicado na entidade — sem isso, o
     * card "A noite caiu… Noite 2" ficava arquivado sob "Noite 1".
     */
    noite = partida.rodada,
  ): Acontecimento[] {
    const evento: Acontecimento = {
      id: randomUUID(),
      tipo,
      texto,
      noite,
      em: new Date().toISOString(),
    };
    const lista = [...(partida.acontecimentos ?? []), evento].slice(
      -ISOLATEUS.MAX_ACONTECIMENTOS,
    );
    partida.acontecimentos = lista;
    return lista;
  }

  // ===== A Noite =====

  /**
   * O deslocamento: o habitante anda **um setor**, pelas estradas do mapa.
   *
   * Mover é também confirmar — quem andou fechou sua jogada da noite. Passar o
   * próprio setor como destino é o "eu fico", tratado por `confirmarPosicao`.
   */
  async mover(
    alunoId: string,
    partidaId: string,
    setorId: string,
  ): Promise<IsolateusMatchEntity> {
    const { partida, segredo } = await this.carregar(partidaId);
    const habitante = this.habitanteDaNoite(partida, segredo, alunoId);

    // A origem é onde a noite começou (a posição pública): trocar de ideia
    // vale, encadear dois passos não.
    const origem = habitante.setorId;
    if (setorId !== origem && !saoVizinhos(origem, setorId)) {
      throw new BadRequestException({
        code: 'SEM_ESTRADA',
        message: 'Não há estrada daqui para lá. Você anda um setor por noite.',
      });
    }

    // O destino fica no cofre até o fechamento da noite; voltar à origem
    // desfaz o deslocamento.
    const posicoes = (segredo.posicoesNoite ?? []).filter(
      (p) => p.habitanteId !== habitante.id,
    );
    if (setorId !== origem) {
      posicoes.push({ habitanteId: habitante.id, setorId });
    }
    segredo.posicoesNoite = posicoes;
    await this.matches.commitPartida(partidaId, {}, { posicoesNoite: posicoes });
    return this.registrarConfirmacao(partida, segredo, alunoId);
  }

  /**
   * Onde o habitante está AGORA: durante a noite, o destino guardado no cofre
   * (se ele andou); fora dela, a posição pública. Toda validação que depende de
   * lugar passa por aqui — nunca por `habitante.setorId` direto.
   */
  private posicaoDe(
    segredo: IsolateusSegredoEntity,
    habitante: Habitante,
  ): string {
    return (
      segredo.posicoesNoite?.find((p) => p.habitanteId === habitante.id)
        ?.setorId ?? habitante.setorId
    );
  }

  /** "Eu fico." Fecha a jogada da noite sem sair do lugar. */
  async confirmarPosicao(
    alunoId: string,
    partidaId: string,
  ): Promise<IsolateusMatchEntity> {
    const { partida, segredo } = await this.carregar(partidaId);
    this.habitanteDaNoite(partida, segredo, alunoId);
    return this.registrarConfirmacao(partida, segredo, alunoId);
  }

  /** O habitante do aluno, exigindo que ele esteja na vila e que seja noite. */
  private habitanteDaNoite(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
    alunoId: string,
  ) {
    if (partida.status !== 'DESLOCAMENTO') {
      throw new BadRequestException('A noite não está aberta.');
    }
    const habitante = this.habitanteDoAluno(partida, segredo, alunoId);
    if (!habitante.vivo || habitante.preso) {
      throw new ForbiddenException('Quem saiu da vila não se desloca.');
    }
    return habitante;
  }

  /**
   * Contabiliza a confirmação e, quando **todos** os habitantes reais na vila já
   * fecharam a jogada, encerra a noite na hora — ninguém fica olhando um
   * cronômetro que não serve mais a ninguém (mesmo Avanço Rápido do debate).
   *
   * Idempotente: confirmar duas vezes não conta dobrado.
   */
  private async registrarConfirmacao(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
    alunoId: string,
  ): Promise<IsolateusMatchEntity> {
    const confirmacoes = [
      ...new Set([...(segredo.confirmacoesNoite ?? []), alunoId]),
    ];
    segredo.confirmacoesNoite = confirmacoes;
    partida.movimentosRecebidos = confirmacoes.length;
    await this.matches.commitPartida(
      partida.id,
      { movimentosRecebidos: confirmacoes.length },
      { confirmacoesNoite: confirmacoes },
    );

    if (this.noiteEstaFechada(partida, segredo)) {
      return this.fecharNoite(partida, segredo);
    }
    await this.encurtarPelaCarencia(partida, segredo);
    return partida;
  }

  /**
   * A vila inteira já decidiu e só falta a jogada da Ameaça: o resto da janela
   * vira a **carência** (`CARENCIA_AMEACA_MS`).
   *
   * O encurtamento é feito **rebaseando `faseIniciadaEm`** em vez de criar um
   * segundo prazo: todos os relógios (telão e celulares) já contam a partir
   * desse campo, e `resolverPorTempo` revalida contra ele. Um campo só, uma
   * verdade só.
   *
   * O que ele **não** faz é dizer que falta a Ameaça: o relógio encurta para
   * todo mundo ao mesmo tempo, sem nomear ninguém. Apontar o habitante que falta
   * seria entregar o alienígena por eliminação, já que cada aldeão sabe que
   * confirmou.
   */
  private async encurtarPelaCarencia(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): Promise<void> {
    if (partida.status !== 'DESLOCAMENTO' || this.ameacasJogaram(partida, segredo)) return;
    if (!this.vilaConfirmou(partida, segredo) || !partida.faseIniciadaEm) return;

    const fim =
      Date.parse(partida.faseIniciadaEm) + ISOLATEUS.LIMITE_DESLOCAMENTO_MS;
    const novoFim = Date.now() + ISOLATEUS.CARENCIA_AMEACA_MS;
    // Só encurta: uma segunda confirmação (ou um relógio torto) não pode
    // devolver tempo a quem já está na carência.
    if (novoFim >= fim) return;

    const base = new Date(
      novoFim - ISOLATEUS.LIMITE_DESLOCAMENTO_MS,
    ).toISOString();
    partida.faseIniciadaEm = base;
    await this.matches.commitPartida(partida.id, { faseIniciadaEm: base });
  }

  /**
   * A noite só fecha cedo quando **todos** os reais confirmaram **e** todas as
   * Ameaças livres já jogaram. Fechar sem a jogada de uma delas transformaria a
   * pressa da vila numa forma de anular o turno do infiltrado.
   */
  private noiteEstaFechada(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): boolean {
    return (
      this.vilaConfirmou(partida, segredo) &&
      this.ameacasJogaram(partida, segredo)
    );
  }

  /** As Ameaças que ainda estão na vila (nem presas, nem fora). */
  private ameacasLivres(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): string[] {
    return segredo.ameacasIds().filter((alunoId) => {
      const h = partida.habitantes.find(
        (x) => x.id === segredo.habitanteDe(alunoId),
      );
      return !!h && h.vivo && !h.preso;
    });
  }

  /** Toda Ameaça livre já fechou a jogada desta noite. */
  private ameacasJogaram(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): boolean {
    const jogaram = new Set(segredo.acoesDaNoite().map((j) => j.alunoId));
    return this.ameacasLivres(partida, segredo).every((a) => jogaram.has(a));
  }

  /**
   * Todos os habitantes reais na vila fecharam a posição da noite.
   *
   * A Ameaça conta aqui **pelo deslocamento dela**, como qualquer um: se ela só
   * entrasse na conta depois de atacar, o contador público pararia em `N-1`
   * exatamente nas noites em que ela ainda não agiu — e a vila leria o nome do
   * alienígena no número.
   */
  private vilaConfirmou(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): boolean {
    const reais = this.reaisNaVila(partida, segredo);
    return (segredo.confirmacoesNoite ?? []).length >= reais.length;
  }

  /**
   * O amanhecer. Ponto **único** de virada da noite para o dia: move os NPCs,
   * publica as posições finais e abre a questão.
   *
   * Ter um ponto só importa porque antes era a ação da Ameaça que virava o dia:
   * ela controlava o relógio da turma, e demorar a agir era um *tell* dela.
   */
  private async fecharNoite(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): Promise<IsolateusMatchEntity> {
    // Reais e NPCs aparecem nas posições novas no MESMO commit: nenhum
    // movimento fica visível antes do outro.
    for (const { habitanteId, setorId } of segredo.posicoesNoite ?? []) {
      const h = partida.habitantes.find((x) => x.id === habitanteId);
      if (h) h.setorId = setorId;
    }
    this.moverNpcs(partida, segredo);

    // O prazo dos poderes: o ganho numa rodada vale até ESTE fechamento (o da
    // noite seguinte). Controles de rodadas passadas também saem.
    Object.assign(segredo, {
      confirmacoesNoite: [],
      posicoesNoite: [],
      poderes: (segredo.poderes ?? []).filter(
        (p) => p.ganhoNaRodada >= partida.rodada,
      ),
      controles: (segredo.controles ?? []).filter(
        (c) => c.rodada >= partida.rodada,
      ),
    });
    // O Delírio Coletivo troca nomes e ids no MESMO commit em que as posições
    // novas aparecem: nome e lugar mudam juntos, e casar "quem era quem" pela
    // posição fica mais difícil.
    const delirou = this.aplicarDelirio(partida, segredo);
    await this.matches.commitPartida(
      partida.id,
      {
        habitantes: partida.habitantes,
        ...(delirou ? { acontecimentos: partida.acontecimentos } : {}),
      },
      {
        confirmacoesNoite: segredo.confirmacoesNoite,
        posicoesNoite: segredo.posicoesNoite,
        poderes: segredo.poderes,
        controles: segredo.controles,
        ...(delirou
          ? {
              delirioPendente: false,
              vinculos: segredo.vinculos,
              acoesRodada: segredo.acoesRodada,
            }
          : {}),
      },
    );

    // A sabotagem NÃO é contestada: ela acerta e o setor cai na hora. O que a
    // vila pode fazer é reconstruir depois, marchando até lá (§5.2).
    const caidos = this.aplicarSabotagens(partida, segredo);
    for (const setor of caidos) {
      this.registrar(
        partida,
        'SABOTAGEM',
        `O ${setor.nome} foi sabotado e está em ruínas.`,
      );
    }
    // O Contágio escolhido se materializa aqui, junto dos demais danos da
    // noite — sem card e sem Diário: a vila só vê a barra cair.
    const contagio = this.aplicarContagio(partida, segredo);
    if (caidos.length || contagio) {
      await this.matches.commitPartida(
        partida.id,
        {
          setores: partida.setores,
          esperanca: partida.esperanca,
          acontecimentos: partida.acontecimentos,
        },
        contagio ?? {},
      );
      if (partida.esperanca <= 0) {
        return this.encerrar(partida, segredo, {
          lado: 'AMEACA',
          motivo:
            'A AMEAÇA VENCEU: a Barra de Esperança chegou a zero. A vila não resistiu à invasão.',
        });
      }
    }

    // A questão do dia só existe se houver disputa: uma abdução a repelir ou um
    // reparo a fazer. Noite de pura sabotagem passa sem pergunta — e deixa a
    // ruína no mapa cobrando reação.
    const temAbducao = segredo
      .acoesDaNoite()
      .some((j) => j.acao.tipo === 'ABDUZIR');
    if (!temAbducao && !partida.reparoSetorId) {
      const resumo = this.resumoSemDisputa(partida, caidos);
      // A sabotagem já registrou o próprio evento; só a noite calma falta.
      if (!caidos.length) this.registrar(partida, 'ESPERA', resumo.texto);
      return this.abrirJanelaDeDecisao(partida, resumo);
    }
    return this.ativarQuestao(partida, segredo, this.alertaDaNoite(partida, segredo));
  }

  /**
   * O Delírio Coletivo: a vila inteira troca de codinome entre si, numa
   * permutação sem ponto fixo (ninguém fica com o próprio nome) — e os
   * `habitanteId` são regerados, senão bastaria seguir o id pelo DevTools para
   * desfazer a troca. Tudo que aponta para um habitante no cofre é remapeado.
   *
   * Trocar só o nome da Ameaça seria uma confissão (só ela pode mudar de nome);
   * trocando todos, o Diário anuncia o delírio sem dizer quem o causou.
   * Devolve `false` se não havia delírio a aplicar.
   */
  private aplicarDelirio(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): boolean {
    if (!segredo.delirioPendente) return false;
    segredo.delirioPendente = false;
    const todos = partida.habitantes;
    if (todos.length < 2) return false;

    // Rotacionar uma ordem embaralhada é uma permutação sem ponto fixo.
    const ordem = embaralhar(todos.map((_, i) => i));
    const nomes = todos.map((h) => h.nome);
    const novoId = new Map<string, string>();
    ordem.forEach((i, k) => {
      const doProximo = ordem[(k + 1) % ordem.length];
      novoId.set(todos[i].id, randomUUID());
      todos[i].nome = nomes[doProximo];
    });
    const trocar = (id: string) => novoId.get(id) ?? id;
    for (const h of todos) h.id = trocar(h.id);

    segredo.vinculos = segredo.vinculos.map((v) => ({
      ...v,
      habitanteId: trocar(v.habitanteId),
    }));
    segredo.controles = (segredo.controles ?? []).map((c) => ({
      ...c,
      habitanteId: trocar(c.habitanteId),
    }));
    segredo.acoesRodada = segredo.acoesDaNoite().map((j) => ({
      ...j,
      acao: j.acao.alvoId ? { ...j.acao, alvoId: trocar(j.acao.alvoId) } : j.acao,
    }));
    segredo.acaoRodada = null;

    this.registrar(
      partida,
      'DELIRIO',
      'Um delírio coletivo tomou a vila: ninguém mais atende pelo mesmo nome.',
    );
    return true;
  }

  /**
   * O Contágio escolhido pela Ameaça original: um aldeão real livre, sorteado,
   * vira Ameaça, e a Esperança cai `DANO_CONTAGIO`. Devolve o que mudou no
   * cofre, ou `null` se não havia contágio a aplicar.
   *
   * Se a original saiu da vila (presa) antes do amanhecer, o contágio morre com
   * ela — só ela contagia.
   */
  private aplicarContagio(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): Partial<IsolateusSegredoEntity> | null {
    if (!segredo.contagioPendente) return null;
    const originalLivre = this.ameacasLivres(partida, segredo).includes(
      segredo.alienAlunoId,
    );
    const alvo = originalLivre
      ? embaralhar(this.alvosDeContagio(partida, segredo))[0]
      : undefined;
    const mudancas: Partial<IsolateusSegredoEntity> = {
      contagioPendente: false,
    };
    if (alvo) {
      mudancas.ameacas = [...segredo.ameacasIds(), alvo];
      partida.esperanca = Math.max(
        0,
        partida.esperanca - ISOLATEUS.DANO_CONTAGIO,
      );
    }
    Object.assign(segredo, mudancas);
    return mudancas;
  }

  /**
   * Materializa as sabotagens da noite (uma por Ameaça que sabotou). Devolve os
   * setores derrubados — vazio se ninguém sabotou.
   */
  private aplicarSabotagens(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): Setor[] {
    const caidos: Setor[] = [];
    for (const { acao } of segredo.acoesDaNoite()) {
      if (acao.tipo !== 'SABOTAR') continue;
      const setor = partida.setores.find((s) => s.id === acao.setorId);
      if (!setor?.intacto) continue; // duas no mesmo setor: cai uma vez só
      setor.intacto = false;
      partida.esperanca = Math.max(
        0,
        partida.esperanca - ISOLATEUS.DANO_SABOTAGEM,
      );
      caidos.push(setor);
    }
    return caidos;
  }

  /** O card do dia quando não houve questão nenhuma. */
  private resumoSemDisputa(
    partida: IsolateusMatchEntity,
    caidos: Setor[],
  ): ResumoRodada {
    if (caidos.length) {
      const nomes = caidos.map((s) => s.nome).join(' e o ');
      const verbo =
        caidos.length > 1 ? 'foram sabotados e estão' : 'foi sabotado e está';
      return {
        seq: partida.rodada,
        defendida: false,
        texto: `O ${nomes} ${verbo} em ruínas. Alguém precisa ir até lá reconstruir.`,
      };
    }
    // Nem sabotagem, nem abdução, nem reparo. O texto é o mesmo que a vila veria
    // se a Ameaça tivesse desconectado: dizer "ela não agiu" a denunciaria.
    return {
      seq: partida.rodada,
      defendida: true,
      texto: 'A noite passou sem incidentes.',
    };
  }

  /** O alerta global do amanhecer — nunca revela o alvo nem o modo do ataque. */
  private alertaDaNoite(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): AlertaRodada {
    if (segredo.acoesDaNoite().some((j) => j.acao.tipo === 'ABDUZIR')) {
      // Um só texto para presencial e às cegas: textos distintos contariam à
      // vila se a Ameaça agiu de perto ou de longe.
      return {
        tipo: 'ABDUCAO',
        texto: 'ALERTA: Tentativa de Abdução na calada da noite!',
      };
    }
    const setor = partida.setores.find((s) => s.id === partida.reparoSetorId);
    return {
      tipo: 'SABOTAGEM',
      texto: `ALERTA: a vila tenta reconstruir o ${setor?.nome ?? 'setor'}!`,
    };
  }

  /**
   * A Névoa de Guerra também anda. Cada NPC troca de setor com probabilidade
   * `CHANCE_MOVER_NPC`, pelas mesmas estradas que os habitantes reais usam.
   *
   * Decidido aqui, no fechamento — e não ao longo da janela —, para que ninguém
   * veja um NPC se mexendo fora de hora e conclua que aquele habitante não é um
   * colega tomando decisão.
   */
  private moverNpcs(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): void {
    const npcs = new Set(segredo.npcIds);
    for (const h of partida.habitantes) {
      if (!npcs.has(h.id) || !h.vivo || h.preso) continue;
      if (Math.random() >= ISOLATEUS.CHANCE_MOVER_NPC) continue;
      const destinos = vizinhosDe(h.setorId);
      if (!destinos.length) continue;
      h.setorId = destinos[Math.floor(Math.random() * destinos.length)];
    }
  }

  /**
   * O Turno da Ameaça: sabotar um setor ou abduzir um morador. A escolha é
   * gravada **no cofre** e só se materializa se a vila errar a questão — a vila
   * vê apenas o alerta ("O Setor de Saúde foi sabotado!"), nunca o alvo da abdução.
   */
  async acaoAmeaca(
    alunoId: string,
    partidaId: string,
    dto: AcaoAmeacaDto,
  ): Promise<IsolateusMatchEntity> {
    const { partida, segredo } = await this.carregar(partidaId);
    if (!segredo.ehAmeaca(alunoId)) {
      throw new ForbiddenException('Você é um Aldeão.');
    }
    if (partida.status !== 'DESLOCAMENTO') {
      throw new BadRequestException('A noite não está aberta.');
    }
    const jogadas = segredo.acoesDaNoite();
    if (jogadas.some((j) => j.alunoId === alunoId)) {
      throw new BadRequestException({
        code: 'JOGADA_FEITA',
        message: 'Você já fez sua jogada esta noite.',
      });
    }

    const acao = this.montarJogada(partida, segredo, alunoId, dto);
    const acoesRodada = [...jogadas, { alunoId, acao }];
    segredo.acoesRodada = acoesRodada;
    segredo.acaoRodada = null;
    await this.matches.commitPartida(
      partidaId,
      {},
      { acoesRodada, acaoRodada: null },
    );

    // A jogada da Ameaça também é uma confirmação da noite dela — e é ela que
    // pode ser a última peça a faltar para o amanhecer.
    return this.registrarConfirmacao(partida, segredo, alunoId);
  }

  // ===== Os Poderes Alienígenas =====

  /**
   * A Ameaça gasta o poder ganho no acerto. **Nada** é escrito no doc público
   * aqui: a escolha fica no cofre, e os efeitos que a vila pode ver (queda de
   * Esperança do Contágio, nomes trocados do Delírio) só se materializam no
   * fechamento da noite, junto de tudo o que muda nela — nunca no instante em
   * que alguém toca no celular.
   */
  async usarPoder(
    alunoId: string,
    partidaId: string,
    dto: UsarPoderDto,
  ): Promise<PainelHabitante> {
    const { partida, segredo } = await this.carregar(partidaId);
    if (!segredo.ehAmeaca(alunoId)) {
      throw new ForbiddenException('Você é um Aldeão.');
    }
    const eu = this.habitanteDoAluno(partida, segredo, alunoId);
    if (!eu.vivo || eu.preso) {
      throw new ForbiddenException('Você não está mais na vila.');
    }
    if (partida.status === 'LOBBY' || partida.status === 'ENCERRADO') {
      throw new BadRequestException('A investigação não está em andamento.');
    }
    const poderes = segredo.poderes ?? [];
    if (!poderes.some((p) => p.alunoId === alunoId)) {
      throw new BadRequestException({
        code: 'SEM_PODER',
        message: 'Você não tem um poder para usar agora.',
      });
    }

    const mudancas: Partial<IsolateusSegredoEntity> = {};
    if (dto.poder === 'CONTAGIO') {
      if (alunoId !== segredo.alienAlunoId) {
        throw new BadRequestException({
          code: 'SO_ORIGINAL',
          message: 'Só a Ameaça original pode contagiar.',
        });
      }
      if (!this.alvosDeContagio(partida, segredo).length) {
        throw new BadRequestException({
          code: 'SEM_ALVO',
          message: 'Não há quem contagiar.',
        });
      }
      mudancas.contagioPendente = true;
    } else if (dto.poder === 'DELIRIO') {
      mudancas.delirioPendente = true;
    } else {
      const alvo = partida.vivos.find((h) => h.id === dto.alvoId);
      if (!alvo || alvo.id === eu.id || segredo.ehAmeaca(segredo.alunoDe(alvo.id))) {
        throw new BadRequestException(
          'Escolha um habitante na vila que não seja uma Ameaça.',
        );
      }
      // Escolhido na noite, vale para ela; escolhido de dia, para a próxima.
      const rodada =
        partida.status === 'DESLOCAMENTO' ? partida.rodada : partida.rodada + 1;
      mudancas.controles = [
        ...(segredo.controles ?? []).filter((c) => c.ameacaAlunoId !== alunoId),
        { ameacaAlunoId: alunoId, habitanteId: alvo.id, rodada },
      ];
    }
    mudancas.poderes = poderes.filter((p) => p.alunoId !== alunoId);

    Object.assign(segredo, mudancas);
    await this.matches.commitPartida(partidaId, {}, mudancas);
    return this.painel(alunoId, partidaId);
  }

  /**
   * Valida a jogada e a normaliza para o cofre.
   *
   * A regra de ouro aqui é **não confiar no cliente para nada que a UI dele não
   * deveria mostrar**: a sabotagem usa o setor onde a Ameaça está (não o que ela
   * mandou), e a abdução presencial só aceita alvo do próprio setor — pedir
   * alguém de outro lugar seria enxergar o que a tela não exibe.
   */
  private montarJogada(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
    alunoId: string,
    dto: AcaoAmeacaDto,
  ): AcaoAmeaca {
    if (dto.tipo === 'AGUARDAR') {
      return { tipo: 'AGUARDAR' };
    }

    const ameaca = this.habitanteDoAluno(partida, segredo, alunoId);
    // Sob Controle Mental, a jogada parte do setor do controlado: ela sabota,
    // enxerga e abduz de lá — e o próprio setor vira o álibi.
    const { setorId: aqui, controlado } = this.origemDaAmeaca(
      partida,
      segredo,
      alunoId,
    );

    if (dto.tipo === 'SABOTAR') {
      // O alvoId do cliente é ignorado: sabota-se onde se está.
      const setor = partida.setores.find((s) => s.id === aqui);
      if (!setor?.intacto) {
        throw new BadRequestException({
          code: 'SETOR_EM_RUINAS',
          message: 'O setor onde você está já está em ruínas.',
        });
      }
      return { tipo: 'SABOTAR', setorId: setor.id };
    }

    // Abdução às cegas: ela aposta num setor, sem saber quem está lá.
    if (dto.setorId) {
      if (dto.setorId === aqui) {
        throw new BadRequestException({
          code: 'SETOR_VISIVEL',
          message: 'Você enxerga este setor — escolha a vítima pelo nome.',
        });
      }
      if (!SETOR_IDS.includes(dto.setorId)) {
        throw new BadRequestException('Este setor não existe no mapa.');
      }
      return { tipo: 'ABDUZIR', setorId: dto.setorId };
    }

    // Abdução presencial: só quem está ao alcance dela.
    const alvo = partida.vivos.find((h) => h.id === dto.alvoId);
    if (!alvo || this.posicaoDe(segredo, alvo) !== aqui) {
      throw new BadRequestException({
        code: 'FORA_DE_ALCANCE',
        message: 'Este habitante não está no seu setor.',
      });
    }
    if (alvo.id === ameaca.id) {
      throw new BadRequestException('A Ameaça não pode abduzir a si mesma.');
    }
    if (alvo.id === controlado?.id) {
      throw new BadRequestException(
        'Você age através deste habitante — ele não pode ser a vítima.',
      );
    }
    if (segredo.ehAmeaca(segredo.alunoDe(alvo.id))) {
      throw new BadRequestException({
        code: 'ALIADO',
        message: 'Este habitante é uma Ameaça como você.',
      });
    }
    return { tipo: 'ABDUZIR', alvoId: alvo.id };
  }

  /**
   * O dia sem questão: publica o card do que aconteceu e abre a janela em que a
   * vila pode convocar a Quarentena antes de a noite cair sozinha.
   */
  private async abrirJanelaDeDecisao(
    partida: IsolateusMatchEntity,
    resumo: ResumoRodada,
  ): Promise<IsolateusMatchEntity> {
    const dados: Partial<IsolateusMatchEntity> = {
      status: 'RESULTADO_RODADA',
      faseIniciadaEm: new Date().toISOString(),
      questaoPublica: null,
      corretaIndex: null,
      resumoRodada: resumo,
      reparoSetorId: null,
    };
    Object.assign(partida, dados);
    await this.matches.commitPartida(partida.id, dados, { acaoRodada: null, acoesRodada: [] });
    partida.reparoSetorId = null;
    return partida;
  }

  /**
   * A Reconstrução: um aldeão **dentro** de um setor em ruínas organiza o
   * reparo. É isso que engatilha a Perícia — a questão que a turma responde para
   * reerguer o setor.
   *
   * A declaração é **anônima** na camada pública. NPC nenhum organiza reparo:
   * um autor visível seria atestado de que aquele habitante é real, e a Névoa
   * de Guerra encolheria sozinha a cada noite.
   */
  async declararReparo(
    alunoId: string,
    partidaId: string,
  ): Promise<IsolateusMatchEntity> {
    const { partida, segredo } = await this.carregar(partidaId);
    const habitante = this.habitanteDaNoite(partida, segredo, alunoId);

    const aqui = this.posicaoDe(segredo, habitante);
    const setor = partida.setores.find((s) => s.id === aqui);
    if (!setor) {
      throw new BadRequestException('Setor desconhecido.');
    }
    if (setor.intacto) {
      throw new BadRequestException({
        code: 'SETOR_INTACTO',
        message: 'Este setor está de pé. Não há o que reconstruir aqui.',
      });
    }
    if (partida.reparoSetorId) {
      throw new BadRequestException({
        code: 'REPARO_EM_ANDAMENTO',
        message: 'Já há um reparo em andamento esta noite.',
      });
    }

    partida.reparoSetorId = setor.id;
    await this.matches.commitPartida(partidaId, {
      reparoSetorId: setor.id,
      // Sem autor: NPC nenhum organiza reparo, e assinar a declaração seria
      // atestar publicamente que aquele habitante é real.
      acontecimentos: this.registrar(
        partida,
        'REPARO',
        `A vila mobilizou um reparo no ${setor.nome}.`,
      ),
    });
    // Declarar o reparo também fecha a jogada da noite de quem declarou.
    return this.registrarConfirmacao(partida, segredo, alunoId);
  }

  /**
   * Publica o alerta e a questão da rodada. A `questaoPublica` vai SEM a
   * alternativa correta — ela só aparece no doc quando a rodada é resolvida.
   */
  private async ativarQuestao(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
    alerta: AlertaRodada,
  ): Promise<IsolateusMatchEntity> {
    const questao = await this.questaoDaRodada(partida);
    if (!questao) {
      // O banco acabou no meio da noite: encerra pelo critério de esgotamento em
      // vez de deixar a turma numa fase sem pergunta.
      return this.encerrar(partida, segredo, this.vereditoPorEsgotamento(partida));
    }

    const dados: Partial<IsolateusMatchEntity> = {
      status: 'QUESTAO_ATIVA',
      faseIniciadaEm: new Date().toISOString(),
      questaoPublica: {
        enunciado: questao.enunciado,
        alternativas: questao.alternativas,
      },
      corretaIndex: null,
      alerta,
      rumores: [], // só o Sinal Interceptado entra no feed da questão
      resumoRodada: null,
    };
    Object.assign(partida, dados);
    await this.matches.commitPartida(partida.id, dados);
    return partida;
  }

  // ===== A Defesa =====

  /**
   * O voto na solução. Quem já foi abduzido ou preso **continua respondendo e
   * pontuando** na sua tela hackeada (§7), mas o voto dele não defende mais a
   * vila — ele não está lá.
   */
  async responder(
    alunoId: string,
    partidaId: string,
    alternativaIndex: number,
  ): Promise<{ registrada: boolean }> {
    const { partida, segredo } = await this.carregar(partidaId);
    if (partida.status !== 'QUESTAO_ATIVA') {
      throw new BadRequestException('Não há problema em aberto.');
    }
    this.habitanteDoAluno(partida, segredo, alunoId); // barra quem não é da vila
    const questao = await this.questaoDaRodada(partida);
    if (!questao) {
      throw new BadRequestException('A investigação ficou sem questões.');
    }

    const correta = alternativaIndex === questao.corretaIndex;
    const tempoMs = partida.faseIniciadaEm
      ? Date.now() - Date.parse(partida.faseIniciadaEm)
      : 0;
    const pontos = this.computarPontos(
      correta,
      tempoMs,
      partida.duracaoSegundos,
    );

    const registrada = await this.matches.registrarResposta(
      partidaId,
      partida.rodada,
      { alunoId, alternativaIndex, correta, pontos },
    );
    if (!registrada) {
      return { registrada: false }; // já havia respondido esta rodada
    }
    await this.creditarPontos(segredo, alunoId, pontos);

    // Avanço rápido: resolvido assim que todos os habitantes reais AINDA NA VILA
    // tiverem votado (quem está fora responde por XP, mas não trava a rodada).
    const respostas = await this.matches.lerRespostas(partidaId, partida.rodada);
    const votantes = this.reaisNaVila(partida, segredo);
    const votaram = respostas.filter((r) =>
      votantes.some((v) => v.alunoId === r.alunoId),
    );
    if (votaram.length >= votantes.length) {
      await this.resolverRodada(partida, segredo);
    }
    return { registrada: true };
  }

  private computarPontos(
    correta: boolean,
    tempoMs: number,
    duracaoSegundos: number,
  ): number {
    if (!correta) return 0;
    const janela = duracaoSegundos * 1000;
    const fracao = Math.max(0, 1 - tempoMs / janela);
    return (
      ISOLATEUS.PONTOS_ACERTO + Math.round(fracao * ISOLATEUS.BONUS_RAPIDEZ)
    );
  }

  /** Os habitantes reais que ainda estão na vila — os que de fato votam. */
  private reaisNaVila(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): Array<{ alunoId: string; habitanteId: string }> {
    return partida.vivos
      .map((h) => ({ habitanteId: h.id, alunoId: segredo.alunoDe(h.id) }))
      .filter((v): v is { alunoId: string; habitanteId: string } => !!v.alunoId);
  }

  /** Acumula pontos no cofre (o placar só vira público no encerramento). */
  private async creditarPontos(
    segredo: IsolateusSegredoEntity,
    alunoId: string,
    pontos: number,
  ): Promise<void> {
    if (pontos <= 0) return;
    const atual = segredo.pontos ?? {};
    atual[alunoId] = (atual[alunoId] ?? 0) + pontos;
    segredo.pontos = atual;
    await this.matches.commitPartida(segredo.partidaId, {}, { pontos: atual });
  }

  // ===== A Guerra de Frequências =====

  /**
   * O Sinal Interceptado: quem foi abduzido ou preso hackeia a comunicação e
   * tenta guiar os sobreviventes. Chega anônimo — se viesse assinado, a vila
   * saberia quem está fora e por eliminação quem é NPC.
   */
  async sinalDeRadio(
    alunoId: string,
    partidaId: string,
    texto: string,
  ): Promise<IsolateusMatchEntity> {
    const { partida, segredo } = await this.carregar(partidaId);
    const habitante = this.habitanteDoAluno(partida, segredo, alunoId);
    if (habitante.vivo && !habitante.preso) {
      throw new BadRequestException('Você ainda está na vila.');
    }
    if (partida.status !== 'QUESTAO_ATIVA') {
      throw new BadRequestException('Não há transmissão em aberto.');
    }

    const rumor: Rumor = {
      id: randomUUID(),
      autorNome: 'Sinal Interceptado',
      texto: texto.trim().slice(0, 240),
      tipo: 'SINAL',
    };
    return this.publicarRumor(partida, rumor);
  }

  private async publicarRumor(
    partida: IsolateusMatchEntity,
    rumor: Rumor,
  ): Promise<IsolateusMatchEntity> {
    const rumores = [...partida.rumores, rumor].slice(-40);
    partida.rumores = rumores;
    await this.matches.commitPartida(partida.id, { rumores });
    return partida;
  }

  // ===== A Resolução =====

  /**
   * O prazo vencido de uma fase cronometrada. Não há timer no servidor (padrão
   * Qlick/Wor): o cliente conta e o servidor **revalida o prazo** antes de agir,
   * com margem de 2s — um cliente adiantado não corta a fase antes.
   *
   * **Qualquer cliente da partida cobra o vencimento** — o telão ou qualquer
   * celular. Enquanto só o projetor podia, a partida inteira dependia de uma
   * única requisição de uma única aba dar certo: bastava um erro de rede, uma
   * aba dormindo ou um relógio adiantado (que faz o cliente disparar cedo e
   * receber "ainda não") para a fase congelar até alguém recarregar a página.
   *
   * Continua idempotente: quem chega depois da virada encontra outro `status` e
   * volta sem efeito, então N clientes cobrando o mesmo prazo produzem UMA
   * transição.
   */
  async resolverPorTempo(
    partidaId: string,
    quem: { professorId?: string; alunoId?: string },
  ): Promise<IsolateusMatchEntity> {
    const { partida, segredo } = await this.carregar(partidaId);
    if (quem.professorId && partida.professorId !== quem.professorId) {
      throw new NotFoundException('Partida nao encontrada.');
    }
    if (quem.alunoId && !segredo.habitanteDe(quem.alunoId)) {
      // Abduzidos e presos continuam valendo: eles seguem na aula, com a mesma
      // tela cronometrada. Quem não é da partida é que não mexe no relógio dela.
      throw new NotFoundException('Partida nao encontrada.');
    }
    if (!partida.faseIniciadaEm) return partida;

    const limite = this.limiteDaFase(partida);
    if (limite === undefined) return partida;

    const decorrido = Date.now() - Date.parse(partida.faseIniciadaEm);
    if (decorrido < limite - ISOLATEUS.MARGEM_TEMPO_MS) {
      return partida;
    }
    return this.encerrarFase(partida, segredo);
  }

  /**
   * O professor pula o tempo restante da fase cronometrada corrente. O clique
   * dele vale pela unanimidade: a fase termina na hora, pela MESMA transição do
   * prazo zerado — pular nunca pode divergir do fim natural do relógio.
   *
   * `statusExibido` é a fase que o telão mostrava no clique. Se a partida já
   * virou (o relógio zerou ou o último aluno pulou no mesmo instante), o clique
   * volta sem efeito: um pulo atrasado não pode derrubar DUAS fases.
   */
  async pularFase(
    professorId: string,
    partidaId: string,
    statusExibido?: StatusIsolateus,
  ): Promise<IsolateusMatchEntity> {
    const { partida, segredo } = await this.carregar(partidaId);
    if (partida.professorId !== professorId) {
      throw new NotFoundException('Partida nao encontrada.');
    }
    if (statusExibido && statusExibido !== partida.status) {
      return partida;
    }
    if (this.limiteDaFase(partida) === undefined) {
      throw new BadRequestException('Não há cronômetro correndo nesta fase.');
    }
    return this.encerrarFase(partida, segredo);
  }

  /** Duração de cada fase cronometrada; `undefined` = fase sem relógio. */
  private limiteDaFase(partida: IsolateusMatchEntity): number | undefined {
    const limites: Partial<Record<StatusIsolateus, number>> = {
      DESLOCAMENTO: ISOLATEUS.LIMITE_DESLOCAMENTO_MS,
      RESULTADO_RODADA: ISOLATEUS.JANELA_DECISAO_MS,
      QUESTAO_ATIVA: partida.duracaoSegundos * 1000,
      QUARENTENA_DEBATE: ISOLATEUS.LIMITE_DEBATE_MS,
      QUARENTENA_VOTO: ISOLATEUS.LIMITE_VOTO_MS,
    };
    return limites[partida.status];
  }

  /**
   * O fim de uma fase cronometrada — o que acontece quando o relógio zera.
   * Único ponto de transição para os dois gatilhos: o prazo vencido
   * (`resolverPorTempo`) e o pulo do professor (`pularFase`).
   */
  private async encerrarFase(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): Promise<IsolateusMatchEntity> {
    if (partida.status === 'DESLOCAMENTO') {
      return this.fecharNoite(partida, segredo);
    }
    if (partida.status === 'RESULTADO_RODADA') {
      // A janela de decisão zerou sem Quarentena: a noite cai sozinha.
      return this.avancarNoite(partida, segredo);
    }
    if (partida.status === 'QUESTAO_ATIVA') {
      return this.resolverRodada(partida, segredo);
    }
    if (partida.status === 'QUARENTENA_DEBATE') {
      return this.abrirVotacao(partida);
    }
    return this.apurarQuarentena(partida, segredo);
  }

  /**
   * Apura a votação da vila e materializa (ou não) a jogada da Ameaça.
   *
   * Votam os habitantes reais na vila e os NPCs — estes, randomicamente, no seu
   * desespero. Como o acaso pode empatar, vale o **Instinto Humano** (§3): entre
   * as alternativas empatadas, ganha a mais votada pelos habitantes REAIS; se o
   * empate persistir, a de menor índice (determinístico, testável).
   */
  private async resolverRodada(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): Promise<IsolateusMatchEntity> {
    const questao = await this.questaoDaRodada(partida);
    if (!questao) {
      throw new BadRequestException('A investigação ficou sem questões.');
    }

    const respostas = await this.matches.lerRespostas(
      partida.id,
      partida.rodada,
    );
    // O voto de qualquer Ameaça não defende a vila: ela responde (e pontua)
    // como todos, mas fica fora da apuração — votar errado não a ajuda mais, e
    // votar certo não a prejudica. O avanço rápido (em `responder`) continua
    // esperando por ela, senão o contador denunciaria quantas Ameaças há.
    const votantes = this.reaisNaVila(partida, segredo).filter(
      (v) => !segredo.ehAmeaca(v.alunoId),
    );
    const total = questao.alternativas.length;

    const votosReais = new Array<number>(total).fill(0);
    for (const v of votantes) {
      const r = respostas.find((x) => x.alunoId === v.alunoId);
      if (r && r.alternativaIndex < total) votosReais[r.alternativaIndex]++;
    }

    // Os NPCs decidem randomicamente (Névoa de Guerra).
    const npcsVivos = partida.vivos.filter((h) => !segredo.alunoDe(h.id)).length;
    const votosTotais = [...votosReais];
    for (let i = 0; i < npcsVivos; i++) {
      votosTotais[Math.floor(Math.random() * total)]++;
    }

    const escolhida = this.apurar(votosTotais, votosReais);
    const acertou = escolhida === questao.corretaIndex;

    // Um acerto só, resolvendo tudo o que estava em disputa: a vítima é salva e
    // o setor volta de pé. Errar entrega os dois. É o que mantém uma pergunta
    // por noite, mesmo quando abdução e reparo coincidem.
    const partes = [
      this.resolverAbducao(partida, segredo, acertou),
      this.resolverReparo(partida, acertou),
    ].filter((t): t is string => !!t);

    const pontos = { ...(segredo.pontos ?? {}) };
    if (!acertou) {
      // Cada Ameaça livre pontua pelo erro da turma — o único momento em que a
      // vila disputou com ela e perdeu. A sabotagem, automática, não pontua.
      for (const a of this.ameacasLivres(partida, segredo)) {
        pontos[a] = (pontos[a] ?? 0) + ISOLATEUS.PONTOS_ACERTO;
      }
    }

    const dados: Partial<IsolateusMatchEntity> = {
      status: 'RESULTADO_RODADA',
      corretaIndex: questao.corretaIndex,
      // A janela de decisão começa a correr agora (a Quarentena cabe nela).
      faseIniciadaEm: new Date().toISOString(),
      esperanca: partida.esperanca,
      setores: partida.setores,
      habitantes: partida.habitantes,
      questaoIndex: partida.questaoIndex + 1,
      reparoSetorId: null,
      // `resolverAbducao` e `resolverReparo` já empilharam seus eventos em
      // `partida.acontecimentos`; publicá-los no MESMO commit do estado é o que
      // impede o cliente de mostrar um card antes de o mapa refletir a mudança.
      acontecimentos: partida.acontecimentos,
      resumoRodada: {
        seq: partida.rodada,
        defendida: acertou,
        texto: partes.join(' '),
      },
    };

    const poderes = this.concederPoderes(partida, segredo, respostas);

    Object.assign(partida, dados);
    segredo.pontos = pontos;
    segredo.acaoRodada = null;
    segredo.acoesRodada = [];
    segredo.poderes = poderes;
    await this.matches.commitPartida(partida.id, dados, {
      pontos,
      acaoRodada: null,
      acoesRodada: [],
      poderes,
    });

    // A vila caiu? A Esperança zerada encerra a partida na hora.
    if (partida.esperanca <= 0) {
      return this.encerrar(partida, segredo, {
        lado: 'AMEACA',
        motivo:
          'A AMEAÇA VENCEU: a Barra de Esperança chegou a zero. A vila não resistiu à invasão.',
      });
    }
    return partida;
  }

  /**
   * Toda Ameaça livre que ACERTOU a questão ganha um Poder Alienígena — acertou
   * a vila ou não. Um por acerto, sem acúmulo: o novo substitui o que sobrou.
   * Só o cofre sabe; nada muda no doc público.
   */
  private concederPoderes(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
    respostas: Array<{ alunoId: string; correta: boolean }>,
  ): Array<{ alunoId: string; ganhoNaRodada: number }> {
    const acertaram = new Set(
      this.ameacasLivres(partida, segredo).filter(
        (a) => respostas.find((r) => r.alunoId === a)?.correta,
      ),
    );
    return [
      ...(segredo.poderes ?? []).filter((p) => !acertaram.has(p.alunoId)),
      ...[...acertaram].map((alunoId) => ({
        alunoId,
        ganhoNaRodada: partida.rodada,
      })),
    ];
  }

  /**
   * A abdução, decidida pela questão. Devolve o texto do card, ou `null` se não
   * havia abdução em jogo nesta noite.
   *
   * A vítima da abdução **às cegas** é sorteada aqui, e não na declaração: as
   * posições estão congeladas desde o fechamento da noite, e sortear antes só
   * deixaria o alvo escrito no cofre sem necessidade.
   */
  private resolverAbducao(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
    acertou: boolean,
  ): string | null {
    const abducoes = segredo
      .acoesDaNoite()
      .map((j) => j.acao)
      .filter((acao) => acao.tipo === 'ABDUZIR');
    if (!abducoes.length) return null;

    const REPELIDA = 'A tentativa de abdução foi repelida. Ninguém foi levado.';
    const repelir = () => {
      this.registrar(partida, 'REPELIDA', REPELIDA);
      return REPELIDA;
    };
    // Um acerto só repele todas as abduções da noite — e um card só.
    if (acertou) return repelir();

    const textos: string[] = [];
    for (const acao of abducoes) {
      // A sorte às cegas nunca cai numa Ameaça: elas não se abduzem.
      const alvo = acao.alvoId
        ? partida.vivos.find((h) => h.id === acao.alvoId)
        : embaralhar(
            partida.vivos.filter(
              (h) =>
                h.setorId === acao.setorId &&
                !segredo.ehAmeaca(segredo.alunoDe(h.id)),
            ),
          )[0];
      // Tiro às cegas num setor vazio (ou alvo que saiu da vila antes, ou já
      // levado pela outra Ameaça): ninguém sai.
      if (!alvo) continue;

      alvo.vivo = false;
      partida.esperanca = Math.max(
        0,
        partida.esperanca - ISOLATEUS.DANO_ABDUCAO,
      );
      const setor = partida.setores.find((s) => s.id === alvo.setorId);
      const texto = `${alvo.nome} foi abduzido no ${setor?.nome ?? 'setor'}.`;
      this.registrar(partida, 'ABDUCAO', texto);
      textos.push(texto);
    }

    // Ninguém foi levado: a vila recebe EXATAMENTE o mesmo evento da abdução
    // repelida — texto e tipo. Se diferissem, ela saberia que a Ameaça atirou de
    // longe e errou, e por eliminação onde ela não estava.
    return textos.length ? textos.join(' ') : repelir();
  }

  /** A Perícia do reparo. `null` se ninguém declarou reparo nesta noite. */
  private resolverReparo(
    partida: IsolateusMatchEntity,
    acertou: boolean,
  ): string | null {
    const setor = partida.setores.find((s) => s.id === partida.reparoSetorId);
    if (!setor) return null;

    if (!acertou) {
      const texto = `O reparo do ${setor.nome} fracassou.`;
      this.registrar(partida, 'REPARO_FALHOU', texto);
      return texto;
    }
    setor.intacto = true;
    // Devolve exatamente o que a sabotagem tirou: a barra segue espelhando o mapa.
    partida.esperanca = Math.min(
      ISOLATEUS.ESPERANCA_INICIAL,
      partida.esperanca + ISOLATEUS.CURA_REPARO,
    );
    const texto = `O ${setor.nome} foi reconstruído.`;
    this.registrar(partida, 'RESTAURADO', texto);
    return texto;
  }

  /**
   * O Instinto Humano: no empate, o consenso dos habitantes reais tem peso
   * soberano sobre o voto randômico dos NPCs.
   */
  /**
   * O índice mais votado, com sorteio entre os empatados. Por sorteio e não
   * pelo menor índice: com só votos reais, o empate é comum, e o desempate
   * determinístico condenaria sempre quem está no começo da lista.
   */
  private maisVotadoComSorteio(votos: number[]): number {
    const maximo = Math.max(...votos);
    const empatados = votos
      .map((v, i) => ({ v, i }))
      .filter((x) => x.v === maximo)
      .map((x) => x.i);
    return embaralhar(empatados)[0];
  }

  private apurar(votosTotais: number[], votosReais: number[]): number {
    const maximo = Math.max(...votosTotais);
    const empatadas = votosTotais
      .map((v, i) => ({ v, i }))
      .filter((x) => x.v === maximo)
      .map((x) => x.i);
    if (empatadas.length === 1) return empatadas[0];

    const maxReal = Math.max(...empatadas.map((i) => votosReais[i]));
    return empatadas.find((i) => votosReais[i] === maxReal)!;
  }

  /**
   * A noite seguinte, pedida pelo telão ("Adiantar noite").
   *
   * @deprecated O telão usa `pularFase` (que cobre esta e todas as outras fases
   * cronometradas). Mantida para clientes em cache.
   */
  async proxima(
    professorId: string,
    partidaId: string,
  ): Promise<IsolateusMatchEntity> {
    const { partida, segredo } = await this.carregar(partidaId);
    if (partida.professorId !== professorId) {
      throw new NotFoundException('Partida nao encontrada.');
    }
    if (partida.status !== 'RESULTADO_RODADA') {
      throw new BadRequestException('Aguarde a resolução da rodada.');
    }
    return this.avancarNoite(partida, segredo);
  }

  /**
   * O anoitecer propriamente dito. Dispara sozinho quando a janela de decisão
   * zera (qualquer tela da partida cobra o prazo), ou na hora, se o professor
   * adiantar pelo telão.
   *
   * Fim de partida: **as questões acabaram** (o banco é o orçamento pedagógico)
   * ou **o teto de noites foi batido**. O teto existe porque as questões
   * deixaram de contar as noites — sem ele, uma Ameaça que só sabota e uma vila
   * que não reage girariam para sempre.
   */
  private async avancarNoite(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): Promise<IsolateusMatchEntity> {
    const proxima = partida.rodada + 1;
    const semQuestoes = partida.questaoIndex >= partida.totalRodadas;
    if (semQuestoes || proxima >= ISOLATEUS.TETO_NOITES) {
      return this.encerrar(partida, segredo, this.vereditoPorEsgotamento(partida));
    }

    const dados: Partial<IsolateusMatchEntity> = {
      status: 'DESLOCAMENTO',
      rodada: proxima,
      reparoSetorId: null,
      questaoPublica: null,
      corretaIndex: null,
      alerta: null,
      rumores: [],
      resumoRodada: null,
      // O veredito é do dia em que a Quarentena aconteceu: sem limpar aqui, o
      // card do inocente preso reaparecia na janela das noites seguintes.
      vereditoQuarentena: null,
      // A noite é cronometrada: a janela de deslocamento precisa de base.
      faseIniciadaEm: new Date().toISOString(),
      movimentosRecebidos: 0,
      acontecimentos: this.registrar(
        partida,
        'NOITE',
        `A noite caiu sobre a vila. Noite ${proxima + 1}.`,
        proxima,
      ),
    };
    Object.assign(partida, dados);
    segredo.confirmacoesNoite = [];
    await this.matches.commitPartida(partida.id, dados, {
      confirmacoesNoite: [],
      acaoRodada: null,
      acoesRodada: [],
    });
    return partida;
  }

  /**
   * O professor encerra a investigação **no meio do jogo** — o sinal da aula
   * bateu, a turma dispersou, o tempo acabou.
   *
   * O veredito sai pelo **mesmo critério do esgotamento das questões** (§8): o
   * estado do mapa e da população no instante da interrupção. Inventar um
   * "empate" aqui seria pior — a partida tem um placar real acumulado, e os
   * alunos merecem o XP do que já jogaram. O diário registra que a investigação
   * foi interrompida, para o card final não parecer um fim natural.
   *
   * No LOBBY não há o que encerrar: sem Despertar não existem papéis, mapa nem
   * pontuação para julgar.
   */
  async encerrarPeloProfessor(
    professorId: string,
    partidaId: string,
  ): Promise<IsolateusMatchEntity> {
    const { partida, segredo } = await this.carregar(partidaId);
    if (partida.professorId !== professorId) {
      throw new NotFoundException('Partida nao encontrada.');
    }
    if (partida.status === 'ENCERRADO') return partida;
    if (partida.status === 'LOBBY') {
      throw new BadRequestException({
        code: 'INVESTIGACAO_NAO_INICIADA',
        message: 'A investigação ainda não começou.',
      });
    }

    this.registrar(
      partida,
      'FIM',
      'O professor encerrou a investigação. O veredito sai pelo estado da vila neste momento.',
    );
    return this.encerrar(partida, segredo, this.vereditoPorEsgotamento(partida));
  }

  // ===== A Quarentena =====

  /**
   * Convoca a Reunião de Investigação — **a vila convoca, e só a vila**: um
   * habitante real vivo, no Setor de Comunicação, com o rádio de pé.
   *
   * O telão tinha uma convocação própria, sem restrição de setor ("válvula
   * pedagógica"). Ela saiu: o professor furando a regra esvazia justamente o que
   * torna a Comunicação o alvo mais valioso do mapa — e o botão aparecia mesmo
   * quando o rádio estava em ruínas. O controle de ritmo do professor continua
   * sendo "Adiantar noite".
   *
   * É **uma por rodada**: a opção volta sempre que a noite passa, mas a vila não
   * pode encadear convocações dentro da mesma rodada — prender todo mundo por
   * tentativa e erro faria a dedução perder o sentido. Acusar custa caro de
   * qualquer forma: errar tira 20 de Esperança.
   */
  async convocarQuarentena(
    partidaId: string,
    alunoId: string,
  ): Promise<IsolateusMatchEntity> {
    const { partida, segredo } = await this.carregar(partidaId);

    const habitante = this.habitanteDoAluno(partida, segredo, alunoId);
    if (!habitante.vivo || habitante.preso) {
      throw new ForbiddenException('Você não está mais na vila.');
    }
    // O rádio da vila fica na Comunicação: é de lá, e só de lá, que se convoca a
    // reunião. Derrubar esse setor cala a vila até ela reconstruí-lo — e é isso
    // que faz da Comunicação o alvo mais valioso do mapa.
    if (habitante.setorId !== SETOR_COMUNICACAO) {
      throw new ForbiddenException({
        code: 'FORA_DA_COMUNICACAO',
        message:
          'Só quem está no Setor de Comunicação pode convocar a Quarentena.',
      });
    }
    const radio = partida.setores.find((s) => s.id === SETOR_COMUNICACAO);
    if (!radio?.intacto) {
      throw new ForbiddenException({
        code: 'COMUNICACAO_EM_RUINAS',
        message:
          'O Setor de Comunicação está em ruínas. Reconstrua o rádio para convocar a Quarentena.',
      });
    }
    if (partida.status !== 'RESULTADO_RODADA') {
      throw new BadRequestException(
        'A Quarentena só pode ser convocada entre as rodadas.',
      );
    }
    if (partida.quarentenaRodada === partida.rodada) {
      throw new BadRequestException({
        code: 'QUARENTENA_USADA',
        message: 'A vila já entrou em Quarentena nesta rodada.',
      });
    }

    // Sem debate (escolha do lobby), a reunião começa pela urna.
    const comDebate = partida.debateHabilitado !== false;
    const dados: Partial<IsolateusMatchEntity> = {
      status: comDebate ? 'QUARENTENA_DEBATE' : 'QUARENTENA_VOTO',
      quarentenaRodada: partida.rodada,
      faseIniciadaEm: new Date().toISOString(),
      debate: [], // só os alunos falam: fala automática saía sob nome de NPC
      // A Quarentena nova nasce limpa: veredito, votos e pulos são por rodada.
      vereditoQuarentena: null,
      votosRecebidos: 0,
      pulosRecebidos: 0,
      quarentenaConvocadaPor: {
        habitanteId: habitante.id,
        nome: habitante.nome,
      },
      acontecimentos: this.registrar(
        partida,
        'QUARENTENA',
        `${habitante.nome} convocou a Quarentena.`,
      ),
    };
    Object.assign(partida, dados);
    segredo.pulosDebate = [];
    await this.matches.commitPartida(partidaId, dados, { pulosDebate: [] });
    return partida;
  }

  /** O Debate Tático: acusações e defesas por escrito, com o relógio correndo. */
  async debater(
    alunoId: string,
    partidaId: string,
    texto: string,
  ): Promise<IsolateusMatchEntity> {
    const { partida, segredo } = await this.carregar(partidaId);
    if (partida.status !== 'QUARENTENA_DEBATE') {
      throw new BadRequestException('O debate não está aberto.');
    }
    const habitante = this.habitanteDoAluno(partida, segredo, alunoId);
    if (!habitante.vivo || habitante.preso) {
      throw new ForbiddenException('Quem saiu da vila não debate.');
    }

    const debate = [
      ...partida.debate,
      {
        id: randomUUID(),
        autorNome: habitante.nome, // o pseudônimo, nunca o nome real
        texto: texto.trim().slice(0, 240),
      },
    ].slice(-60);
    partida.debate = debate;
    await this.matches.commitPartida(partidaId, { debate });
    return partida;
  }

  /**
   * Avanço Rápido do debate: quem já se decidiu abre mão do papo. Quando TODOS os
   * habitantes reais na vila pulam, a votação abre na hora — ninguém fica olhando
   * um cronômetro que não serve mais a ninguém.
   *
   * Idempotente: pular duas vezes não conta dobrado.
   */
  async pularDebate(
    alunoId: string,
    partidaId: string,
  ): Promise<IsolateusMatchEntity> {
    const { partida, segredo } = await this.carregar(partidaId);
    if (partida.status !== 'QUARENTENA_DEBATE') {
      throw new BadRequestException('O debate não está aberto.');
    }
    const habitante = this.habitanteDoAluno(partida, segredo, alunoId);
    if (!habitante.vivo || habitante.preso) {
      throw new ForbiddenException('Quem saiu da vila não debate.');
    }

    const pulos = [...new Set([...(segredo.pulosDebate ?? []), alunoId])];
    partida.pulosRecebidos = pulos.length;
    segredo.pulosDebate = pulos;
    await this.matches.commitPartida(
      partidaId,
      { pulosRecebidos: pulos.length },
      { pulosDebate: pulos },
    );

    if (pulos.length >= this.reaisNaVila(partida, segredo).length) {
      return this.abrirVotacao(partida);
    }
    return partida;
  }

  /** Fim do debate: o teclado trava e a vila deposita seus votos. */
  private async abrirVotacao(
    partida: IsolateusMatchEntity,
  ): Promise<IsolateusMatchEntity> {
    const dados: Partial<IsolateusMatchEntity> = {
      status: 'QUARENTENA_VOTO',
      faseIniciadaEm: new Date().toISOString(),
    };
    Object.assign(partida, dados);
    await this.matches.commitPartida(partida.id, dados);
    return partida;
  }

  /** O Veredito: cada habitante deposita seu voto num suspeito. */
  async votarSuspeito(
    alunoId: string,
    partidaId: string,
    suspeitoId: string,
  ): Promise<{ registrado: boolean }> {
    const { partida, segredo } = await this.carregar(partidaId);
    if (partida.status !== 'QUARENTENA_VOTO') {
      throw new BadRequestException('A votação não está aberta.');
    }
    const habitante = this.habitanteDoAluno(partida, segredo, alunoId);
    if (!habitante.vivo || habitante.preso) {
      throw new ForbiddenException('Quem saiu da vila não vota.');
    }
    if (!partida.vivos.some((h) => h.id === suspeitoId)) {
      throw new BadRequestException('Esse habitante não está mais na vila.');
    }

    const registrado = await this.matches.registrarVoto(
      partidaId,
      partida.rodada,
      alunoId,
      suspeitoId,
    );
    if (!registrado) {
      return { registrado: false };
    }

    const votos = await this.matches.lerVotos(partidaId, partida.rodada);
    const votantes = this.reaisNaVila(partida, segredo);
    partida.votosRecebidos = votos.length;
    await this.matches.commitPartida(partidaId, {
      votosRecebidos: votos.length,
    });

    // Avanço Rápido: consenso fechado, o tempo restante é cortado (§5).
    if (votos.length >= votantes.length) {
      await this.apurarQuarentena(partida, segredo);
    }
    return { registrado: true };
  }

  /**
   * A Revelação. Apura os votos dos habitantes reais e tranca o mais votado;
   * no empate (inclusive sem voto nenhum), sorteio entre os empatados.
   *
   * Se for a Ameaça, a invasão é contida e a Vila vence. Se for um inocente, a
   * Esperança sofre dano severo e **a identidade do preso permanece em segredo**
   * (§5) — a vila nunca fica sabendo se trancou um NPC ou um colega.
   */
  private async apurarQuarentena(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): Promise<IsolateusMatchEntity> {
    const candidatos = partida.vivos;
    const votos = await this.matches.lerVotos(partida.id, partida.rodada);

    const votosReais = new Array<number>(candidatos.length).fill(0);
    for (const v of votos) {
      const i = candidatos.findIndex((h) => h.id === v.suspeitoId);
      if (i >= 0) votosReais[i]++;
    }
    // Só a turma decide quem é preso: o voto aleatório dos NPCs era ruído que
    // podia decidir a prisão sozinho (025 §2.3). A expulsão continua
    // obrigatória — sem voto nenhum, todos empatam em zero e o sorteio cobre.
    const preso = candidatos[this.maisVotadoComSorteio(votosReais)];
    preso.preso = true;
    const eraAmeaca = segredo.ehAmeaca(segredo.alunoDe(preso.id));

    // Trancou uma Ameaça, mas o Contágio deixou outra solta: a partida segue.
    // O veredito não diz quantas restam — só que a invasão não acabou.
    if (eraAmeaca && this.ameacasLivres(partida, segredo).length) {
      const texto = `Vocês trancaram uma AMEAÇA! ${preso.nome} era um infiltrado. Mas a invasão não acabou…`;
      const dados: Partial<IsolateusMatchEntity> = {
        status: 'RESULTADO_RODADA',
        habitantes: partida.habitantes,
        faseIniciadaEm: new Date().toISOString(),
        quarentenaConvocadaPor: null,
        vereditoQuarentena: { presoNome: preso.nome, eraAmeaca: true, texto },
        acontecimentos: this.registrar(partida, 'VEREDITO', texto),
      };
      Object.assign(partida, dados);
      await this.matches.commitPartida(partida.id, dados);
      return partida;
    }

    if (eraAmeaca) {
      const dados: Partial<IsolateusMatchEntity> = {
        habitantes: partida.habitantes,
        quarentenaConvocadaPor: null,
        vereditoQuarentena: {
          presoNome: preso.nome,
          eraAmeaca: true,
          texto: `Vocês contiveram a AMEAÇA! ${preso.nome} era o infiltrado.`,
        },
        acontecimentos: this.registrar(
          partida,
          'VEREDITO',
          `Vocês contiveram a AMEAÇA: ${preso.nome} era o infiltrado.`,
        ),
      };
      Object.assign(partida, dados);
      await this.matches.commitPartida(partida.id, dados);
      return this.encerrar(partida, segredo, {
        lado: 'VILA',
        motivo:
          'A VILA VENCEU: vocês identificaram e trancaram o Alienígena na Quarentena.',
      });
    }

    partida.esperanca = Math.max(
      0,
      partida.esperanca - ISOLATEUS.DANO_INOCENTE,
    );
    const dados: Partial<IsolateusMatchEntity> = {
      status: 'RESULTADO_RODADA',
      habitantes: partida.habitantes,
      esperanca: partida.esperanca,
      // A janela de decisão reabre COM relógio: é nela que a turma lê o
      // veredito, e zerada ela faz a noite cair sozinha. Com base nula, o
      // prazo nunca vencia e a partida só andava por "Adiantar noite".
      faseIniciadaEm: new Date().toISOString(),
      quarentenaConvocadaPor: null,
      vereditoQuarentena: {
        presoNome: preso.nome,
        eraAmeaca: false,
        // A identidade original do preso permanece em segredo (§5).
        texto: `Vocês aprisionaram um INOCENTE. ${preso.nome} não era a Ameaça — e ela continua entre vocês.`,
      },
      // O diário não diz se o preso era real ou NPC: a identidade dele fica em
      // segredo (014 §5).
      acontecimentos: this.registrar(
        partida,
        'VEREDITO',
        `Vocês aprisionaram um INOCENTE: ${preso.nome}.`,
      ),
    };
    Object.assign(partida, dados);
    await this.matches.commitPartida(partida.id, dados);

    if (partida.esperanca <= 0) {
      return this.encerrar(partida, segredo, {
        lado: 'AMEACA',
        motivo:
          'A AMEAÇA VENCEU: a vila trancou um inocente e a Barra de Esperança chegou a zero.',
      });
    }
    return partida;
  }

  // ===== O Veredito =====

  /**
   * Fim por esgotamento das questões (§8). A vila tem 6 setores; avalia-se o
   * nível de destruição e de preservação.
   *
   * Os dois lados podem bater seu critério ao mesmo tempo (ex.: metade da vila
   * abduzida **e** 4 setores intactos). A spec não desempata, então **a Ameaça é
   * avaliada primeiro**: se a invasão atingiu qualquer um dos seus objetivos, ela
   * venceu. Se nenhum lado atingir nada, a Vila vence por resistência — a
   * invasão simplesmente fracassou.
   */
  private vereditoPorEsgotamento(partida: IsolateusMatchEntity) {
    const totalHabitantes = partida.habitantes.length;
    const fora = partida.habitantes.filter((h) => !h.vivo).length; // abduzidos
    const danificados = ISOLATEUS.TOTAL_SETORES - partida.setoresIntactos;

    if (fora > totalHabitantes / 2) {
      return {
        lado: 'AMEACA' as const,
        motivo:
          'A AMEAÇA VENCEU: o infiltrado conseguiu abduzir mais da metade da população no meio da noite.',
      };
    }
    if (danificados > 3) {
      return {
        lado: 'AMEACA' as const,
        motivo:
          'A AMEAÇA VENCEU: a sabotagem foi implacável e o Alienígena destruiu mais de 3 setores vitais.',
      };
    }
    if (partida.setoresIntactos > 3) {
      return {
        lado: 'VILA' as const,
        motivo:
          'A VILA VENCEU: vocês impediram a invasão e mantiveram mais de 3 setores intactos e seguros.',
      };
    }
    return {
      lado: 'VILA' as const,
      motivo:
        'A VILA VENCEU: a resistência foi forte e vocês garantiram que mais da metade da vila sobrevivesse até o fim da quarentena.',
    };
  }

  /**
   * Encerra a partida, publica o placar (agora que o mistério acabou) e converte
   * os pontos em XP do portal. O lado vencedor leva o bônus de Vitória de Partida.
   */
  private async encerrar(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
    veredito: { lado: 'VILA' | 'AMEACA'; motivo: string },
  ): Promise<IsolateusMatchEntity> {
    const pontos = { ...(segredo.pontos ?? {}) };
    const alienVenceu = veredito.lado === 'AMEACA';

    for (const vinculo of segredo.vinculos) {
      if (!vinculo.alunoId) continue; // NPC não pontua
      const ehAlien = segredo.ehAmeaca(vinculo.alunoId);
      if (ehAlien === alienVenceu) {
        pontos[vinculo.alunoId] =
          (pontos[vinculo.alunoId] ?? 0) + ISOLATEUS.BONUS_VITORIA;
      }
    }

    const nomePorAluno = new Map(
      segredo.vinculos
        .filter((v) => v.alunoId)
        .map((v) => [
          v.alunoId!,
          partida.habitantes.find((h) => h.id === v.habitanteId)?.nome ??
            'Habitante',
        ]),
    );
    const rankingFinal = [...nomePorAluno.keys()]
      .map((alunoId) => ({
        alunoId,
        nome: nomePorAluno.get(alunoId)!,
        pontos: pontos[alunoId] ?? 0,
      }))
      .sort((a, b) => b.pontos - a.pontos)
      .map((p, i) => ({ posicao: i + 1, ...p }));

    const dados: Partial<IsolateusMatchEntity> = {
      status: 'ENCERRADO',
      veredito,
      rankingFinal,
      questaoPublica: null,
      faseIniciadaEm: null,
      acontecimentos: this.registrar(partida, 'FIM', veredito.motivo),
    };
    Object.assign(partida, dados);
    segredo.pontos = pontos;
    await this.matches.commitPartida(partida.id, dados, { pontos });

    if (partida.turmaId) {
      await this.xp.creditarPartida(
        partida.turmaId,
        rankingFinal.map((p) => ({ alunoId: p.alunoId, pontos: p.pontos })),
        'ISOLATEUS',
      );
    }
    return partida;
  }
}
