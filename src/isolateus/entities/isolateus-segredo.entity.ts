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

  /** O aluno sorteado como Ameaça (sempre um habitante real). */
  alienAlunoId: string;

  /** habitanteId → alunoId. Sem `alunoId`, o habitante é um NPC. */
  vinculos: VinculoHabitante[];

  /** A ação escolhida pelo Alien nesta rodada (limpa ao resolvê-la). */
  acaoRodada: AcaoAmeaca | null;

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

  /** Pontos acumulados por aluno (só viram ranking público no encerramento). */
  pontos: Record<string, number>;

  constructor(partial: Partial<IsolateusSegredoEntity> = {}) {
    Object.assign(this, partial);
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
