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
import {
  ISOLATEUS,
  IsolateusMatchEntity,
  MensagemDebate,
  Rumor,
} from './entities/isolateus-match.entity';
import { IsolateusSegredoEntity } from './entities/isolateus-segredo.entity';
import { IsolateusJogoRepository } from './isolateus-jogo.repository';
import { IsolateusMatchRepository } from './isolateus-match.repository';
import { FRASES_DEBATE_NPC, FRASES_NPC } from './isolateus.data';

/** Autor anônimo do feed quando a vila não tem NPCs para vestir o rumor. */
const VOZ_ANONIMA = 'Voz na Névoa';

/** Quantas frases de ruído entram no Chat de Rumores a cada rodada. */
const RUIDO_POR_RODADA = 4;

/** O que o aluno recebe sobre si mesmo — por REST, jamais pelo snapshot. */
export interface PainelHabitante {
  papel: 'ALDEAO' | 'AMEACA';
  habitanteId: string;
  vivo: boolean;
  preso: boolean;
  /** Só para a Ameaça: a solução verdadeira do problema no ar (§4). */
  corretaIndex?: number;
  /** Só para a Ameaça: nomes sob os quais ela pode forjar um rumor. */
  disfarces?: string[];
}

/**
 * O motor da invasão: turno da Ameaça, defesa da vila, Chat de Rumores,
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

  /** A questão da rodada corrente (vive na coleção fechada da investigação). */
  private async questaoDaRodada(partida: IsolateusMatchEntity) {
    const jogo = await this.jogos.findById(partida.jogoId);
    return jogo?.questoes[partida.rodada];
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

    const base: PainelHabitante = {
      papel: segredo.alienAlunoId === alunoId ? 'AMEACA' : 'ALDEAO',
      habitanteId: habitante.id,
      vivo: habitante.vivo,
      preso: habitante.preso,
    };
    if (base.papel !== 'AMEACA') {
      return base;
    }

    const questao = await this.questaoDaRodada(partida);
    return {
      ...base,
      corretaIndex: questao?.corretaIndex,
      disfarces: this.disfarces(partida, segredo),
    };
  }

  /**
   * Os nomes sob os quais a Ameaça pode transmitir sem se expor: os NPCs vivos.
   * Numa vila grande (10+ reais) não há NPC (§2) — aí o rumor sai como uma voz
   * anônima, em vez de o motor incriminar um habitante real inocente.
   */
  private disfarces(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): string[] {
    const npcs = new Set(segredo.npcIds);
    const nomes = partida.vivos
      .filter((h) => npcs.has(h.id))
      .map((h) => h.nome);
    return nomes.length ? nomes : [VOZ_ANONIMA];
  }

  /**
   * O Turno da Ameaça: sabotar um setor ou abduzir um morador. A escolha é
   * gravada **no cofre** e só se materializa se a vila errar a questão — a vila
   * vê apenas o alerta ("O Setor Médico foi sabotado!"), nunca o alvo da abdução.
   */
  async acaoAmeaca(
    alunoId: string,
    partidaId: string,
    dto: AcaoAmeacaDto,
  ): Promise<IsolateusMatchEntity> {
    const { partida, segredo } = await this.carregar(partidaId);
    if (segredo.alienAlunoId !== alunoId) {
      throw new ForbiddenException('Você é um Aldeão.');
    }
    if (partida.status !== 'TURNO_AMEACA') {
      throw new BadRequestException('Não é o turno da Ameaça.');
    }

    const alerta = this.validarAlvo(partida, segredo, dto);
    return this.ativarQuestao(
      partida,
      segredo,
      { tipo: dto.tipo, alvoId: dto.alvoId },
      alerta,
    );
  }

  /** Valida o alvo e devolve o alerta global correspondente. */
  private validarAlvo(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
    dto: AcaoAmeacaDto,
  ): { tipo: 'SABOTAGEM' | 'ABDUCAO'; texto: string } {
    if (dto.tipo === 'SABOTAR') {
      const setor = partida.setores.find((s) => s.id === dto.alvoId);
      if (!setor || !setor.intacto) {
        throw new BadRequestException('Este setor já está em ruínas.');
      }
      return {
        tipo: 'SABOTAGEM',
        texto: `ALERTA: O ${setor.nome} foi sabotado!`,
      };
    }

    const alvo = partida.vivos.find((h) => h.id === dto.alvoId);
    if (!alvo) {
      throw new BadRequestException('Este habitante não está mais na vila.');
    }
    if (segredo.alunoDe(alvo.id) === segredo.alienAlunoId) {
      throw new BadRequestException('A Ameaça não pode abduzir a si mesma.');
    }
    return {
      tipo: 'ABDUCAO',
      texto: 'ALERTA: Tentativa de Abdução na calada da noite!',
    };
  }

  /**
   * Publica o alerta e a questão da rodada. A `questaoPublica` vai SEM a
   * alternativa correta — ela só aparece no doc quando a rodada é resolvida.
   */
  private async ativarQuestao(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
    acao: { tipo: 'SABOTAR' | 'ABDUZIR'; alvoId: string },
    alerta: { tipo: 'SABOTAGEM' | 'ABDUCAO'; texto: string },
  ): Promise<IsolateusMatchEntity> {
    const questao = await this.questaoDaRodada(partida);
    if (!questao) {
      throw new BadRequestException('A investigação ficou sem questões.');
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
      rumores: this.semearRuido(partida, segredo),
      resumoRodada: null,
    };
    Object.assign(partida, dados);
    await this.matches.commitPartida(partida.id, dados, { acaoRodada: acao });
    return partida;
  }

  /**
   * A Guerra de Frequências começa com ruído: falas soltas de moradores
   * desesperados. É o pano de fundo em que o rumor forjado da Ameaça e os Sinais
   * dos abduzidos se misturam, para que nenhum deles se destaque sozinho.
   *
   * O ruído sai **só** no nome dos NPCs (ou anônimo). Pôr uma frase automática
   * na boca de um habitante real seria o motor fabricando prova contra um aluno
   * que não escreveu nada — e a dedução dos outros passaria a punir um inocente.
   */
  private semearRuido(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): Rumor[] {
    const autores = embaralhar(this.disfarces(partida, segredo));
    const frases = embaralhar(FRASES_NPC).slice(0, RUIDO_POR_RODADA);
    return frases.map((texto, i) => ({
      id: randomUUID(),
      autorNome: autores[i % autores.length],
      texto,
      tipo: 'RUMOR' as const,
    }));
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
   * A Sabotagem de Frequência: a Ameaça conhece a solução verdadeira e transmite
   * um argumento defendendo uma falsa, sob o nome de um NPC. Uma vez por rodada.
   */
  async forjarRumor(
    alunoId: string,
    partidaId: string,
    texto: string,
  ): Promise<IsolateusMatchEntity> {
    const { partida, segredo } = await this.carregar(partidaId);
    if (segredo.alienAlunoId !== alunoId) {
      throw new ForbiddenException('Você é um Aldeão.');
    }
    if (partida.status !== 'QUESTAO_ATIVA') {
      throw new BadRequestException('Não há transmissão em aberto.');
    }
    if (partida.rumores.some((r) => r.tipo === 'FORJADO')) {
      throw new BadRequestException({
        code: 'RUMOR_JA_ENVIADO',
        message: 'Você já interceptou a comunicação nesta rodada.',
      });
    }

    const disfarces = this.disfarces(partida, segredo);
    const rumor: Rumor = {
      id: randomUUID(),
      autorNome: embaralhar(disfarces)[0],
      texto: texto.trim().slice(0, 240),
      tipo: 'FORJADO',
    };
    return this.publicarRumor(partida, rumor);
  }

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
   * O projetor fecha a fase cronometrada quando o relógio zera. Não há timer no
   * servidor (padrão Qlick/Wor): o cliente conta e o servidor **revalida o prazo**
   * antes de agir, com margem de 2s — um cliente adiantado não corta a fase antes.
   */
  async resolverPorTempo(
    professorId: string,
    partidaId: string,
  ): Promise<IsolateusMatchEntity> {
    const { partida, segredo } = await this.carregar(partidaId);
    if (partida.professorId !== professorId) {
      throw new NotFoundException('Partida nao encontrada.');
    }
    if (!partida.faseIniciadaEm) return partida;

    const limites: Partial<Record<typeof partida.status, number>> = {
      QUESTAO_ATIVA: partida.duracaoSegundos * 1000,
      QUARENTENA_DEBATE: ISOLATEUS.LIMITE_DEBATE_MS,
      QUARENTENA_VOTO: ISOLATEUS.LIMITE_VOTO_MS,
    };
    const limite = limites[partida.status];
    if (limite === undefined) return partida;

    const decorrido = Date.now() - Date.parse(partida.faseIniciadaEm);
    if (decorrido < limite - ISOLATEUS.MARGEM_TEMPO_MS) {
      return partida;
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
    const votantes = this.reaisNaVila(partida, segredo);
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
    const defendida = escolhida === questao.corretaIndex;

    const dados: Partial<IsolateusMatchEntity> = {
      status: 'RESULTADO_RODADA',
      corretaIndex: questao.corretaIndex,
      faseIniciadaEm: null,
    };
    const pontos = { ...(segredo.pontos ?? {}) };

    if (defendida) {
      dados.resumoRodada = {
        seq: partida.rodada,
        defendida: true,
        texto: 'Defesa bem-sucedida! O setor resistiu e ninguém foi levado.',
      };
    } else {
      // A vila errou: a jogada da Ameaça se materializa. E o infiltrado pontua
      // como se tivesse acertado a questão — a sabotagem foi validada (§7).
      const texto = this.aplicarSabotagem(partida, segredo);
      dados.esperanca = partida.esperanca;
      dados.setores = partida.setores;
      dados.habitantes = partida.habitantes;
      dados.resumoRodada = { seq: partida.rodada, defendida: false, texto };
      pontos[segredo.alienAlunoId] =
        (pontos[segredo.alienAlunoId] ?? 0) + ISOLATEUS.PONTOS_ACERTO;
    }

    Object.assign(partida, dados);
    segredo.pontos = pontos;
    segredo.acaoRodada = null;
    await this.matches.commitPartida(partida.id, dados, {
      pontos,
      acaoRodada: null,
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
   * O Instinto Humano: no empate, o consenso dos habitantes reais tem peso
   * soberano sobre o voto randômico dos NPCs.
   */
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

  /** Materializa a jogada da Ameaça e devolve o texto do card global. */
  private aplicarSabotagem(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): string {
    const acao = segredo.acaoRodada;
    if (!acao) {
      return 'A vila errou a defesa, mas a Ameaça hesitou.';
    }

    if (acao.tipo === 'SABOTAR') {
      const setor = partida.setores.find((s) => s.id === acao.alvoId);
      if (setor?.intacto) {
        setor.intacto = false;
        partida.esperanca = Math.max(
          0,
          partida.esperanca - ISOLATEUS.DANO_SABOTAGEM,
        );
        return `A Vila sofreu danos: o ${setor.nome} está em ruínas.`;
      }
      return 'A sabotagem falhou por pouco.';
    }

    const alvo = partida.habitantes.find((h) => h.id === acao.alvoId);
    if (alvo?.vivo && !alvo.preso) {
      alvo.vivo = false;
      partida.esperanca = Math.max(
        0,
        partida.esperanca - ISOLATEUS.DANO_ABDUCAO,
      );
      return `${alvo.nome} foi abduzido durante a noite.`;
    }
    return 'A abdução falhou por pouco.';
  }

  /** O professor avança para a próxima noite — ou o tempo simplesmente acaba. */
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

    const proxima = partida.rodada + 1;
    if (proxima >= partida.totalRodadas) {
      return this.encerrar(partida, segredo, this.vereditoPorEsgotamento(partida));
    }

    const dados: Partial<IsolateusMatchEntity> = {
      status: 'TURNO_AMEACA',
      rodada: proxima,
      questaoPublica: null,
      corretaIndex: null,
      alerta: null,
      rumores: [],
      resumoRodada: null,
      faseIniciadaEm: null,
    };
    Object.assign(partida, dados);
    await this.matches.commitPartida(partida.id, dados);
    return partida;
  }

  // ===== A Quarentena =====

  /**
   * Convoca a Reunião de Investigação. Pode partir de **qualquer habitante real
   * vivo** (o botão vermelho entre as rodadas) ou do professor, pelo telão.
   *
   * É **uma por rodada**: a opção volta sempre que a noite passa, mas a vila não
   * pode encadear convocações dentro da mesma rodada — prender todo mundo por
   * tentativa e erro faria a dedução perder o sentido. Acusar custa caro de
   * qualquer forma: errar tira 20 de Esperança.
   */
  async convocarQuarentena(
    partidaId: string,
    quem: { alunoId?: string; professorId?: string },
  ): Promise<IsolateusMatchEntity> {
    const { partida, segredo } = await this.carregar(partidaId);

    if (quem.professorId && partida.professorId !== quem.professorId) {
      throw new NotFoundException('Partida nao encontrada.');
    }
    if (quem.alunoId) {
      const habitante = this.habitanteDoAluno(partida, segredo, quem.alunoId);
      if (!habitante.vivo || habitante.preso) {
        throw new ForbiddenException('Você não está mais na vila.');
      }
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

    const dados: Partial<IsolateusMatchEntity> = {
      status: 'QUARENTENA_DEBATE',
      quarentenaRodada: partida.rodada,
      faseIniciadaEm: new Date().toISOString(),
      debate: this.semearDebate(partida, segredo),
      // A Quarentena nova nasce limpa: veredito, votos e pulos são por rodada.
      vereditoQuarentena: null,
      votosRecebidos: 0,
      pulosRecebidos: 0,
    };
    Object.assign(partida, dados);
    segredo.pulosDebate = [];
    await this.matches.commitPartida(partidaId, dados, { pulosDebate: [] });
    return partida;
  }

  /** Os NPCs também trocam acusações — o mesmo cuidado do ruído se aplica. */
  private semearDebate(
    partida: IsolateusMatchEntity,
    segredo: IsolateusSegredoEntity,
  ): MensagemDebate[] {
    const autores = embaralhar(this.disfarces(partida, segredo));
    const frases = embaralhar(FRASES_DEBATE_NPC).slice(0, RUIDO_POR_RODADA);
    return frases.map((texto, i) => ({
      id: randomUUID(),
      autorNome: autores[i % autores.length],
      texto,
    }));
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
   * A Revelação. Apura os votos (reais + NPCs randômicos, com o mesmo Instinto
   * Humano no empate) e tranca o mais votado.
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
    const npcsVivos = candidatos.filter((h) => !segredo.alunoDe(h.id)).length;
    const votosTotais = [...votosReais];
    for (let i = 0; i < npcsVivos; i++) {
      votosTotais[Math.floor(Math.random() * candidatos.length)]++;
    }

    const preso = candidatos[this.apurar(votosTotais, votosReais)];
    preso.preso = true;
    const eraAmeaca = segredo.alunoDe(preso.id) === segredo.alienAlunoId;

    if (eraAmeaca) {
      const dados: Partial<IsolateusMatchEntity> = {
        habitantes: partida.habitantes,
        vereditoQuarentena: {
          presoNome: preso.nome,
          eraAmeaca: true,
          texto: `Vocês contiveram a AMEAÇA! ${preso.nome} era o infiltrado.`,
        },
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
      faseIniciadaEm: null,
      vereditoQuarentena: {
        presoNome: preso.nome,
        eraAmeaca: false,
        // A identidade original do preso permanece em segredo (§5).
        texto: `Vocês aprisionaram um INOCENTE. ${preso.nome} não era a Ameaça — e ela continua entre vocês.`,
      },
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
      const ehAlien = vinculo.alunoId === segredo.alienAlunoId;
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
