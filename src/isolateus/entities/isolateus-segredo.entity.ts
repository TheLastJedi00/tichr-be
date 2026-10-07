/**
 * A jogada do Alienígena na noite corrente (só o servidor conhece).
 *
 * `SABOTAR` é sempre no setor onde ela está — o `alvoId` do cliente é ignorado.
 * `ABDUZIR` tem duas formas, e o campo preenchido diz qual foi:
 *
 * *   `alvoId` → **presencial**: ela viu a fileira do próprio setor e escolheu a
 *     vítima pelo nome.
 * *   `setorId` → **às cegas**: ela apostou num setor qualquer do mapa sem saber
 *     quem está lá; a vítima é sorteada na resolução.
 *
 * A vila **nunca** distingue as duas: a sabotagem entrega a posição da Ameaça
 * com certeza, mas a abdução é ambígua de propósito (§5.1.1 da spec 023).
 */
export interface AcaoAmeaca {
  tipo: 'SABOTAR' | 'ABDUZIR' | 'AGUARDAR';
  /** Habitante alvo (abdução presencial). */
  alvoId?: string;
  /** Setor apostado (abdução às cegas). */
  setorId?: string;
}

/** Vínculo entre um habitante da vila e o aluno por trás dele. Sem `alunoId` = NPC. */
export interface VinculoHabitante {
  habitanteId: string;
  alunoId?: string;
}

/**
 * O COFRE da partida (`isolateus_segredos/{partidaId}`).
 *
 * É a razão de o jogo ser jogável: aqui moram as informações ocultas — quem é a
 * Ameaça, quais habitantes são NPCs e o que o Alienígena escolheu fazer nesta
 * rodada. A coleção fica **fechada nas Firestore Rules** (nem leitura, nem
 * escrita para o cliente): só o Admin SDK do backend a enxerga. O aluno recebe
 * sua fatia por REST autenticado (`GET /aluno/isolateus/:id/painel`), e a fatia
 * do Aldeão não contém nada além do próprio papel.
 */
export class IsolateusSegredoEntity {
  id: string; // = partidaId
  partidaId: string;

  /**
   * A Ameaça ORIGINAL — a sorteada no Despertar (sempre um habitante real). É a
   * única que pode contagiar e a única que o rodízio da turma conta.
   */
  alienAlunoId: string;

  /**
   * Todas as Ameaças da partida (alunoIds), a original inclusa. Cresce com o
   * Contágio. Ausente em partidas anteriores ao poder: leia por `ameacasIds()`.
   */
  ameacas?: string[];

  /** habitanteId → alunoId. Sem `alunoId`, o habitante é um NPC. */
  vinculos: VinculoHabitante[];

  /**
   * @deprecated Campo único da época de uma Ameaça só. Só é lido (por
   * `acoesDaNoite`) em partidas antigas; o motor grava `acoesRodada`.
   */
  acaoRodada?: AcaoAmeaca | null;

  /**
   * A jogada de cada Ameaça nesta noite (limpa ao resolvê-la). Lista, e não
   * mapa: o cofre é gravado com `merge`, e um mapa vazio não apaga chaves.
   */
  acoesRodada?: Array<{ alunoId: string; acao: AcaoAmeaca }>;

  /**
   * Alunos que pularam o Debate da Quarentena corrente (limpa a cada convocação).
   * Mora no cofre porque a lista denunciaria quem é real e quem é NPC — a vila só
   * enxerga a CONTAGEM, em `pulosRecebidos`.
   */
  pulosDebate: string[];

  /**
   * Alunos que já fecharam a própria jogada da noite (moveram-se ou confirmaram
   * que ficam). Limpa a cada noite.
   *
   * Mesma razão de `pulosDebate` para viver no cofre: a lista é uma lista de
   * habitantes **reais**, e publicá-la entregaria a Névoa de Guerra de graça. A
   * vila só vê a contagem, em `movimentosRecebidos`.
   */
  confirmacoesNoite: string[];

  /**
   * Para onde cada habitante real se deslocou NESTA noite (só quem andou).
   *
   * Mora no cofre porque publicar o movimento na hora entregava a Névoa de
   * Guerra: os NPCs só andam no fechamento da noite, então quem se mexia no
   * meio da janela era, por eliminação, real. O doc público só recebe as
   * posições em `fecharNoite`, todas de uma vez.
   *
   * Lista, e não mapa, de propósito: o cofre é gravado com `merge`, e um mapa
   * vazio não apaga as chaves antigas — a lista é substituída inteira.
   */
  posicoesNoite: Array<{ habitanteId: string; setorId: string }> = [];

  /**
   * Poderes Alienígenas ganhos e ainda não usados — um por Ameaça, sem acúmulo
   * (o acerto novo substitui o que sobrou). `ganhoNaRodada` marca o prazo: vale
   * até o fechamento da noite seguinte. Lista, pelo mesmo motivo do merge.
   */
  poderes?: Array<{ alunoId: string; ganhoNaRodada: number }>;

  /**
   * Controles Mentais ativos: na `rodada` indicada (a noite e o dia dela), as
   * jogadas da Ameaça partem do setor do habitante controlado. Um por Ameaça.
   */
  controles?: Array<{
    ameacaAlunoId: string;
    habitanteId: string;
    rodada: number;
  }>;

  /** Contágio escolhido, materializado no próximo fechamento da noite. */
  contagioPendente?: boolean;

  /** Delírio Coletivo escolhido, materializado no próximo fechamento da noite. */
  delirioPendente?: boolean;

  /**
   * O resgate organizado nesta noite (025 §6.2). Fica no cofre até o
   * amanhecer: publicado na hora, revelaria que há um habitante real na Saúde.
   */
  resgateNoite?: { alunoId: string } | null;

  /** Pontos acumulados por aluno (só viram ranking público no encerramento). */
  pontos: Record<string, number>;

  constructor(partial: Partial<IsolateusSegredoEntity> = {}) {
    Object.assign(this, partial);
  }

  /** Os alunos que são Ameaça (original + contagiadas). */
  ameacasIds(): string[] {
    return this.ameacas?.length ? this.ameacas : [this.alienAlunoId];
  }

  ehAmeaca(alunoId: string | undefined): boolean {
    return !!alunoId && this.ameacasIds().includes(alunoId);
  }

  /** As jogadas da noite, lendo também o campo único das partidas antigas. */
  acoesDaNoite(): Array<{ alunoId: string; acao: AcaoAmeaca }> {
    if (this.acoesRodada) return this.acoesRodada;
    return this.acaoRodada
      ? [{ alunoId: this.alienAlunoId, acao: this.acaoRodada }]
      : [];
  }

  /** O habitante que representa este aluno na vila. */
  habitanteDe(alunoId: string): string | undefined {
    return this.vinculos.find((v) => v.alunoId === alunoId)?.habitanteId;
  }

  /** O aluno por trás de um habitante (undefined se for NPC). */
  alunoDe(habitanteId: string): string | undefined {
    return this.vinculos.find((v) => v.habitanteId === habitanteId)?.alunoId;
  }

  /** Ids dos habitantes virtuais (NPCs). */
  get npcIds(): string[] {
    return this.vinculos.filter((v) => !v.alunoId).map((v) => v.habitanteId);
  }

  /** Ids dos habitantes reais. */
  get reaisIds(): string[] {
    return this.vinculos.filter((v) => !!v.alunoId).map((v) => v.habitanteId);
  }
}
