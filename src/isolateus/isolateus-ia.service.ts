import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ProfessorService } from '../professor/professor.service';
import { GeminiService } from '../wor/gemini.service';
import { GerarQuestoesDto } from './dto/gerar-questoes.dto';
import { QuestaoIsolateus } from './entities/isolateus-jogo.entity';
import { ISOLATEUS_LOCKED } from './isolateus-jogo.service';

/** Quantidade de questões geradas por chamada e alternativas por questão (§9.1). */
const QTD_QUESTOES = 10;
const QTD_ALTERNATIVAS = 4;

/**
 * Orquestra a geração das questões do Tichr Isolateus por IA, com **rate limit de
 * 1×/dia por professor** (contador próprio, separado do Qlick e do Wor) e gate de
 * plano **PhD**. As questões são os enigmas que defendem os setores da vila; o
 * professor edita o lote depois. A rota não persiste nada.
 */
@Injectable()
export class IsolateusIaService {
  constructor(
    private readonly gemini: GeminiService,
    private readonly professores: ProfessorService,
  ) {}

  async gerarQuestoes(
    uid: string,
    dto: GerarQuestoesDto,
  ): Promise<{ questoes: QuestaoIsolateus[] }> {
    if (!this.gemini.disponivel()) {
      throw new ServiceUnavailableException({
        code: 'IA_INDISPONIVEL',
        message:
          'Geração por IA indisponível. Você pode escrever as questões manualmente.',
      });
    }

    const hoje = new Date().toISOString().slice(0, 10);
    const prof = await this.professores.getProfile(uid);
    if (!prof.podeGamificar) {
      throw new ForbiddenException(ISOLATEUS_LOCKED);
    }
    if (prof.usouIaIsolateusHoje(hoje)) {
      throw new HttpException(
        {
          code: 'IA_RATE_LIMIT',
          message:
            'A transmissão diária com o Comando Central se esgotou! A IA monta as questões 1 vez por dia. Você ainda pode escrever/editar as questões manualmente, ou voltar amanhã.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const prompt = IsolateusIaService.montarPrompt(dto);
    const texto = await this.gemini.gerarTexto(prompt, {
      json: true,
      maxOutputTokens: 4096,
    });
    const questoes = IsolateusIaService.extrairQuestoes(texto);
    if (questoes.length === 0) {
      console.error(`[IsolateusIA] parse vazio. Trecho: ${texto.slice(0, 300)}`);
      throw new ServiceUnavailableException({
        code: 'IA_SEM_RESULTADO',
        message:
          'A IA não retornou questões válidas. Tente novamente com outra descrição.',
      });
    }

    // Só consome a cota diária quando a IA respondeu com questões válidas.
    await this.professores.marcarUsoIaIsolateus(uid);
    return { questoes };
  }

  /**
   * Monta o prompt das questões. O conteúdo é pedagógico e sério (é o que vale
   * XP); a ambientação de vila sob invasão fica só no enunciado, para o aluno
   * sentir que está defendendo um setor — e nunca no lugar da matéria.
   */
  private static montarPrompt(dto: GerarQuestoesDto): string {
    return [
      'Você cria questões de múltipla escolha em português do Brasil para uso em sala de aula.',
      'Elas serão usadas em um jogo de dedução (Tichr Isolateus) em que a turma defende os setores de uma vila isolada respondendo corretamente.',
      dto.disciplina ? `Disciplina: ${dto.disciplina}.` : '',
      dto.topico ? `Tópico da aula: ${dto.topico}.` : '',
      `Instruções do professor: ${dto.instrucao}`,
      `Gere EXATAMENTE ${QTD_QUESTOES} questões, cada uma com ${QTD_ALTERNATIVAS} alternativas e APENAS uma correta.`,
      'O conteúdo deve ser rigorosamente pedagógico: a ambientação do jogo NÃO entra nas questões nem nas alternativas.',
      'As questões devem ser claras e as alternativas plausíveis (sem "todas as anteriores"), porque um infiltrado vai tentar convencer a turma a escolher uma alternativa errada.',
      'Responda SOMENTE com um array JSON, sem markdown, no formato:',
      '[{"enunciado":"...","alternativas":["a","b","c","d"],"corretaIndex":0}]',
      'onde corretaIndex é o índice (base 0) da alternativa correta.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Parse robusto do JSON retornado pela IA. Mantém apenas questões válidas
   * (enunciado + 2..6 alternativas), corrige o `corretaIndex` quando vem fora do
   * range e limita a {@link QTD_QUESTOES}.
   */
  static extrairQuestoes(texto: string): QuestaoIsolateus[] {
    // Remove cercas markdown (```json … ```) que a IA às vezes adiciona.
    const limpo = texto.replace(/```json/gi, '').replace(/```/g, '');
    const match = limpo.match(/\[[\s\S]*\]/);
    if (!match) return [];
    let arr: unknown[];
    try {
      arr = JSON.parse(match[0]) as unknown[];
    } catch {
      return [];
    }
    if (!Array.isArray(arr)) return [];

    const questoes: QuestaoIsolateus[] = [];
    for (const item of arr) {
      const q = item as {
        enunciado?: unknown;
        alternativas?: unknown;
        corretaIndex?: unknown;
      };
      const enunciado = String(q.enunciado ?? '').trim();
      const alternativas = Array.isArray(q.alternativas)
        ? q.alternativas.map((a) => String(a).trim()).filter(Boolean)
        : [];
      if (!enunciado || alternativas.length < 2) continue;
      const alts = alternativas.slice(0, 6);
      let corretaIndex = Number(q.corretaIndex);
      if (
        !Number.isInteger(corretaIndex) ||
        corretaIndex < 0 ||
        corretaIndex >= alts.length
      ) {
        corretaIndex = 0;
      }
      questoes.push({ enunciado, alternativas: alts, corretaIndex });
    }
    return questoes.slice(0, QTD_QUESTOES);
  }
}
