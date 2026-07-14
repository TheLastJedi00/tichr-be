import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { embaralhar } from '../common/shuffle.util';
import { AcaoAmeacaDto } from './dto/acao-ameaca.dto';
import {
  IsolateusMatchEntity,
  Rumor,
} from './entities/isolateus-match.entity';
import { IsolateusSegredoEntity } from './entities/isolateus-segredo.entity';
import { IsolateusJogoRepository } from './isolateus-jogo.repository';
import { IsolateusMatchRepository } from './isolateus-match.repository';
import { FRASES_NPC } from './isolateus.data';

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
}
