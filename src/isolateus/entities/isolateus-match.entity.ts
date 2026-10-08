/** Constantes do motor da invasão. Fonte única dos números do jogo. */
export const ISOLATEUS = {
  /** Barra de Esperança da vila. Zerou, a Ameaça venceu. */
  ESPERANCA_INICIAL: 100,
  /** Um setor danificado (a vila errou a defesa). 6 setores × 15 = 90. */
  DANO_SABOTAGEM: 15,
  /**
   * Cada Contágio drena a Esperança — sem card, sem Diário. Proposto na spec
   * 024: abaixo da sabotagem (15) e do inocente preso (20).
   */
  DANO_CONTAGIO: 10,
  /** Um morador abduzido na calada da noite. */
  DANO_ABDUCAO: 10,
  /** A vila trancou um inocente na Quarentena ("dano severo"). */
  DANO_INOCENTE: 20,
  /**
   * Reconstruir um setor devolve exatamente o que a sabotagem dele tirou. A
   * barra de Esperança continua sendo espelho fiel do estado do mapa.
   */
  CURA_REPARO: 15,

  /** Pontos por acerto + bônus máximo de rapidez (espelha o Qlick). */
  PONTOS_ACERTO: 1000,
  BONUS_RAPIDEZ: 500,
  /** Bônus de "Vitória de Partida" para o lado vencedor (§7). */
  BONUS_VITORIA: 1000,

  /** Mínimo de investigadores reais para iniciar (§2). */
  MIN_REAIS: 4,
  /** Abaixo disto a vila recebe NPCs (Névoa de Guerra). */
  LIMIAR_NEVOA: 10,
  /** Total de setores vitais. */
  TOTAL_SETORES: 6,
  /** Teto do Diário da Vila (mesma disciplina dos 40 rumores). */
  MAX_ACONTECIMENTOS: 60,

  /**
   * Teto de noites da partida. **Válvula de segurança, não orçamento.**
   *
   * As questões deixaram de contar as noites: elas só são consumidas quando há
   * abdução ou reparo. Uma Ameaça que só sabota e uma vila que nunca reage
   * fariam a partida girar para sempre — o teto fecha essa porta.
   *
   * Começou em 15 e subiu para 25 depois da validação em navegador: com 15, uma
   * partida encerrou tendo usado **4 das 10 questões**. O teto estava cortando a
   * aula antes do banco pedagógico acabar, que é justamente o critério de fim
   * que deveria mandar. Com 25, ele volta a ser o que a spec diz que é: o que
   * impede a partida infinita, e nada além disso.
   */
  TETO_NOITES: 25,

  /** Janelas cronometradas (contadas pelo cliente; o servidor só revalida). */
  LIMITE_DEBATE_MS: 90_000,
  LIMITE_VOTO_MS: 60_000,
  /**
   * A noite: janela para se deslocar um setor (ou confirmar que fica).
   *
   * Começou em 20s e subiu para 60s depois da validação em navegador: 20
   * cobriam o clique, não a decisão. O aluno lê o próprio setor, abre o mapa,
   * localiza as ruínas e só então anda — e a Ameaça ainda escolhe a jogada dela
   * dentro da mesma janela.
   */
  LIMITE_DESLOCAMENTO_MS: 60_000,
  /**
   * Quando a vila inteira já fechou a jogada e só falta a Ameaça, a noite não
   * espera o resto do minuto: o relógio colapsa para esta carência.
   *
   * Por que não fechar na hora: o alienígena perderia o turno. Por que não
   * mostrar "falta 1": todo aldeão sabe que confirmou, então o habitante que
   * falta seria, por eliminação, a Ameaça. A carência resolve os dois — o
   * relógio encurta para TODO MUNDO, sem nomear ninguém.
   */
  CARENCIA_AMEACA_MS: 8_000,
  /**
   * O dia: janela em que a vila lê o resultado e pode convocar a Quarentena
   * antes de a noite cair sozinha. Sem ela, o avanço automático tornaria a
   * Quarentena inconvocável.
   */
  JANELA_DECISAO_MS: 15_000,

  /**
   * Chance de um NPC trocar de setor a cada noite.
   *
   * NPC parado seria identificado em uma única noite — e, por eliminação, a vila
   * saberia quem é real, estreitando a caça ao infiltrado sem deduzir nada. O
   * valor aproxima a taxa de movimentação humana observável.
   */
  CHANCE_MOVER_NPC: 0.45,
  /**
   * Faixa (ms desde a abertura da noite) dos avisos de saída dos NPCs (026
   * §2.3). Concentrada no começo da janela, quando os reais decidem: um aviso
   * "atrasado" só sai no fechamento, e lá ele se mistura ao último real.
   */
  NPC_AVISO_JANELA_MS: [1_500, 35_000] as const,
  /**
   * Chance de um NPC que vai andar ganhar um segundo aviso (outro vizinho ou
   * desistir). Os reais podem mudar de ideia; NPC que nunca muda seria pista.
   */
  CHANCE_NPC_MUDAR_IDEIA: 0.15,
  /** Intervalo mínimo entre duas trocas de destino do mesmo aluno (429). */
  MOVER_INTERVALO_MS: 1_000,
  /** Margem de segurança ao revalidar o prazo disparado pelo projetor. */
  MARGEM_TEMPO_MS: 2_000,

  /**
   * A cada quantas noites o brilho misterioso irradia o setor de onde cada
   * Ameaça age (noites 3, 6, 9…). Só sabotar ou abduzir naquela noite o evita:
   * é o que impede a Ameaça de passar a partida inteira só aguardando.
   */
  CICLO_BRILHO: 3,
  /** Mínimo de habitantes (NPCs contam) na Saúde para o resgate valer. */
  MIN_RESGATE: 2,
  /** Votação de quem volta pelo resgate (avanço rápido e pulo do professor). */
  RESGATE_VOTO_MS: 60_000,
  /** Esperança devolvida por um resgate concluído (teto 100). */
  BONUS_RESGATE: 10,
} as const;

export type StatusIsolateus =
  | 'LOBBY'
  /**
   * A noite. Todos se deslocam (ou ficam) e a Ameaça escolhe sua jogada — tudo
   * dentro da mesma janela. Substitui o antigo `TURNO_AMEACA` como fase de
   * abertura da rodada: com o turno separado, a Ameaça controlava sozinha quando
   * o dia começava, e demorar a agir era um *tell* dela.
   */
  | 'DESLOCAMENTO'
  | 'TURNO_AMEACA'
  | 'QUESTAO_ATIVA'
  | 'RESULTADO_RODADA'
  | 'QUARENTENA_DEBATE'
  | 'QUARENTENA_VOTO'
  /** A turma acertou a questão do resgate e vota quem volta (025 §6.4). */
  | 'RESGATE_VOTO'
  | 'ENCERRADO';

/**
 * Um habitante da vila — real ou virtual, **indistinguíveis aqui de propósito**.
 * O `id` é opaco (UUID): o vínculo com o `alunoId` (e portanto quem é NPC) mora
 * só no cofre `isolateus_segredos`, fora do alcance do DevTools.
 */
export interface Habitante {
  id: string;
  nome: string;
  vivo: boolean;
  preso: boolean;
  /**
   * O setor que o habitante ocupa agora. **Público de propósito**: sem posição
   * pública não há mapa. O recorte "só vejo quem está no meu setor" é regra de
   * UI — posição não revela papel nem resposta, e recortá-la no servidor custaria
   * uma rodada de REST por movimento sem proteger segredo nenhum.
   */
  setorId: string;
}

/** Um aviso de saída da noite: o habitante escolheu ir para `para` (026 §2). */
export interface Deslocamento {
  habitanteId: string;
  para: string;
}

/** Um dos 6 setores vitais. */
export interface Setor {
  id: string;
  nome: string;
  intacto: boolean;
}

/**
 * Uma mensagem do feed da questão. Hoje só o `SINAL` — a dica anônima de quem
 * foi abduzido ou preso.
 *
 * O Chat de Rumores (ruído de NPC e o rumor forjado da Ameaça) saiu: seus
 * autores eram sempre NPCs, e o `tipo: 'FORJADO'` era público — a Névoa de
 * Guerra vazava pela própria tela. `RUMOR` fica só para ler partidas antigas.
 */
export interface Rumor {
  id: string;
  autorNome: string;
  texto: string;
  tipo: 'SINAL' | 'RUMOR';
}

/** Uma fala do debate da Quarentena. */
export interface MensagemDebate {
  id: string;
  autorNome: string;
  texto: string;
}

/** O alerta global que abre a rodada. */
export interface AlertaRodada {
  tipo: 'SABOTAGEM' | 'ABDUCAO';
  texto: string;
}

/** O card de resultado da rodada (defesa mantida × dano sofrido). */
export interface ResumoRodada {
  seq: number;
  defendida: boolean;
  texto: string;
}

/** O veredito da Quarentena (sem revelar a identidade do inocente — §5). */
export interface VereditoQuarentena {
  presoNome: string;
  eraAmeaca: boolean;
  texto: string;
}

/**
 * Uma entrada do Diário da Vila — o histórico que a turma pode reler.
 *
 * Cada evento aparece primeiro como modal em todas as telas e depois fica no
 * card scrollable. O que **não** entra aqui é tão importante quanto o que entra:
 * deslocamento não gera evento, porque a lista de quem foi para onde entregaria
 * o mapa inteiro e anularia a informação parcial em que o jogo se apoia.
 */
export interface Acontecimento {
  id: string;
  tipo: TipoAcontecimento;
  texto: string;
  /** A noite em que aconteceu (para agrupar no diário). */
  noite: number;
  em: string;
}

export type TipoAcontecimento =
  | 'NOITE'
  | 'SABOTAGEM'
  | 'ABDUCAO'
  /**
   * Cobre **dois** casos com o mesmo texto: a defesa bem-sucedida e o tiro às
   * cegas que caiu num setor vazio. Separá-los diria à vila se a Ameaça agiu de
   * perto ou de longe — exatamente o que a ambiguidade da abdução protege.
   */
  | 'REPELIDA'
  | 'ESPERA'
  | 'REPARO'
  | 'RESTAURADO'
  | 'REPARO_FALHOU'
  | 'QUARENTENA'
  /** O Delírio Coletivo: todos trocaram de codinome (sem autor). */
  | 'DELIRIO'
  /** O brilho misterioso das noites múltiplas de `CICLO_BRILHO` (um por setor). */
  | 'BRILHO'
  /** O resgate pela Saúde: organizado, cancelado, fracassado ou concluído. */
  | 'RESGATE'
  | 'VEREDITO'
  | 'FIM';

/** O veredito final, com o motivo técnico explícito (§8). */
export interface Veredito {
  lado: 'VILA' | 'AMEACA';
  motivo: string;
}

export interface PlacarItem {
  posicao: number;
  alunoId: string;
  nome: string;
  pontos: number;
}

/**
 * Tichr Isolateus — a CAMADA PÚBLICA de uma partida (`isolateus_partidas/{id}`).
 *
 * O backend (Admin SDK) é a única fonte de escrita; os clientes leem via
 * `onSnapshot`. **Nada aqui pode entregar o mistério**: não há `alienAlunoId`,
 * não há flag de NPC, o `corretaIndex` só aparece depois da rodada resolvida e
 * o placar só é publicado no encerramento (um ranking ao vivo denunciaria quem
 * é real, já que NPC não pontua). O que é segredo vive em `isolateus_segredos`.
 */
export class IsolateusMatchEntity {
  id: string;
  jogoId: string;
  professorId: string;
  turmaId?: string;
  nome: string;

  status: StatusIsolateus;
  criadaEm: string | null;

  /** Barra de Esperança (0..100). */
  esperanca: number;
  setores: Setor[];
  habitantes: Habitante[];

  /** A noite corrente. -1 no lobby, 0-based depois. Conta o ciclo, não a questão. */
  rodada: number;

  /**
   * Ponteiro no banco de questões.
   *
   * Separado de `rodada` de propósito: as questões deixaram de ser consumidas
   * por noite e passaram a sê-lo **por disputa** — só há questão quando a Ameaça
   * abduz ou a vila declara um reparo. Uma noite de sabotagem sem reação não
   * gasta questão nenhuma.
   */
  questaoIndex: number;

  /** Tamanho do banco de questões (o critério de fim por esgotamento). */
  totalRodadas: number;
  duracaoSegundos: number;

  /**
   * O setor com reparo declarado nesta noite (null = nenhum). É o que faz a
   * questão do dia valer também como Perícia de reconstrução.
   *
   * Guarda o setor, não quem declarou: NPC nenhum organiza reparo, e um autor
   * público seria atestado de que aquele habitante é real.
   */
  reparoSetorId: string | null;

  /** Base do cronômetro no cliente (questão, debate ou votação). */
  faseIniciadaEm: string | null;

  questaoPublica: { enunciado: string; alternativas: string[] } | null;
  /** Só preenchido em `RESULTADO_RODADA` — nunca durante a questão. */
  corretaIndex: number | null;

  alerta: AlertaRodada | null;

  /**
   * O Diário da Vila. Aparado nas últimas 60 entradas — o documento é lido por
   * `onSnapshot` a cada mudança, e um histórico ilimitado inflaria toda leitura
   * da partida.
   */
  acontecimentos: Acontecimento[];

  rumores: Rumor[];
  debate: MensagemDebate[];
  resumoRodada: ResumoRodada | null;

  /**
   * Rodada da última Quarentena convocada (null = nenhuma ainda). A vila pode
   * convocar uma por rodada: sempre depois da noite, nunca duas vezes seguidas
   * na mesma — prender em série até acertar trivializaria a dedução.
   */
  quarentenaRodada: number | null;
  /**
   * O Debate Tático antes da votação, escolhido pelo professor no lobby e fixo
   * depois do Despertar. Desligado, a Quarentena vai direto ao voto. Partidas
   * anteriores ao campo são lidas como ligadas (o comportamento de sempre).
   */
  debateHabilitado = true;
  /**
   * Quem convocou a Quarentena em curso (`null` fora dela). **Público de
   * propósito**: convocar à toa custa −20 de Esperança à vila, e sem autor a
   * Ameaça poderia convocar toda rodada sem deixar rastro. Como NPC não convoca,
   * o nome confirma que aquele habitante é real — vazamento aceito (025 §2).
   */
  quarentenaConvocadaPor: { habitanteId: string; nome: string } | null = null;
  /**
   * Quem convocou uma Quarentena que prendeu um inocente fica sem convocar até
   * `ateRodada` (a rodada seguinte). Público: o nome dele já era.
   */
  convocadorBloqueado: { habitanteId: string; ateRodada: number } | null = null;
  /**
   * De quantas em quantas noites o brilho acontece. Gravado no Despertar para o
   * cliente calcular a contagem regressiva sem duplicar a constante.
   */
  cicloBrilho: number = ISOLATEUS.CICLO_BRILHO;
  /** O último brilho: a noite (`rodada`) e os setores que irradiaram. */
  brilho: { rodada: number; setorIds: string[] } | null = null;
  /**
   * Um resgate organizado na Saúde passou pela validação do amanhecer e está
   * em jogo na questão do dia (sem autor: o organizador é anônimo).
   */
  resgatePendente = false;
  /**
   * Os avisos de saída da noite em curso (026 §2): quem escolheu sair e para
   * onde. A origem é o `setorId` público, que só muda no amanhecer. Reais e
   * NPCs entram do mesmo jeito (os NPCs pela agenda do cofre), então o aviso
   * não diz quem é real. O recorte "só o meu setor" é de UI, como as posições.
   */
  deslocamentosNoite: Deslocamento[] = [];
  /**
   * Quem trocou de setor no último amanhecer, para a animação de saídas e
   * chegadas (026 §3). `null` quando houve Delírio na noite: casar nome antigo
   * e novo pelo movimento desfaria a confusão do poder.
   */
  ultimosDeslocamentos: {
    rodada: number;
    movimentos: Array<{ habitanteId: string; de: string; para: string }>;
  } | null = null;
  /** Quantos já votaram no resgate (contagem apenas — o voto é secreto). */
  votosResgateRecebidos = 0;
  /** Quem o último resgate trouxe de volta (o papel dele continua secreto). */
  resgateResultado: { habitanteId: string; nome: string } | null = null;
  vereditoQuarentena: VereditoQuarentena | null;
  /** Quantos já votaram (contagem apenas — o voto em si é secreto). */
  votosRecebidos: number;
  /** Quantos já pularam o debate (contagem apenas — quem pulou é segredo). */
  pulosRecebidos: number;

  /**
   * Quantos habitantes reais já fecharam a jogada da noite. **Contagem apenas**:
   * a lista seria uma lista de reais, e entregaria a Névoa de Guerra.
   */
  movimentosRecebidos: number;

  /**
   * Quem está no lobby. Carrega **só o `alunoId`** — o codinome de cidade é
   * sorteado no Despertar, não aqui.
   *
   * Antes esta lista trazia o pseudônimo digitado, e o telão o exibia enquanto a
   * sala enchia: a turma decorava os nomes reais e, quando os NPCs entravam,
   * sabia por eliminação exatamente quem era virtual. Sem nome no lobby, não há
   * o que decorar.
   *
   * **Apagado ao iniciar** de qualquer forma: a própria lista de `alunoId`
   * casaria com os vínculos e denunciaria o tamanho real da vila.
   */
  inscritos: Array<{ alunoId: string }>;

  veredito: Veredito | null;
  rankingFinal: PlacarItem[];

  constructor(partial: Partial<IsolateusMatchEntity> = {}) {
    Object.assign(this, partial);
  }

  /** Habitantes ainda na vila (não abduzidos, não presos). */
  get vivos(): Habitante[] {
    return this.habitantes.filter((h) => h.vivo && !h.preso);
  }

  get setoresIntactos(): number {
    return this.setores.filter((s) => s.intacto).length;
  }

  /** Habitantes que saíram da vila (abduzidos ou presos). */
  get foraDaVila(): number {
    return this.habitantes.length - this.vivos.length;
  }
}
