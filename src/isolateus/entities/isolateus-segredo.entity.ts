/** A intenção do Alienígena para a rodada corrente (só o servidor conhece). */
export interface AcaoAmeaca {
  tipo: 'SABOTAR' | 'ABDUZIR';
  /** Id do setor (SABOTAR) ou do habitante (ABDUZIR). */
  alvoId: string;
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
