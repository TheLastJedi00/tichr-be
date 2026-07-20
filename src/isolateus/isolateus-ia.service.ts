import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ProfessorService } from '../professor/professor.service';
import { ConfigIaService } from '../ia-governanca/config-ia.service';
import { PromptIaService } from '../ia-governanca/prompt-ia.service';
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
    private readonly prompts: PromptIaService,
    private readonly configIa: ConfigIaService,
  ) {}

  async gerarQuestoes(
    uid: string,
    dto: GerarQuestoesDto,
  ): Promise<{ questoes: QuestaoIsolateus[]; restantes: number }> {
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
    const limite = await this.configIa.limiteGeracoesDia();
    const usados = prof.usosIaHoje('isolateus', hoje);
    if (usados >= limite) {
      throw new HttpException(
        {
          code: 'IA_RATE_LIMIT',
          message:
            'A transmissão diária com o Comando Central se esgotou! A IA monta as questões um número limitado de vezes por dia. Você ainda pode escrever/editar as questões manualmente, ou voltar amanhã.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const prompt = await this.prompts.montar('isolateus', {
      disciplina: dto.disciplina,
      topico: dto.topico,
      instrucao: dto.instrucao,
      quantidades: {
        qtdQuestoes: QTD_QUESTOES,
        qtdAlternativas: QTD_ALTERNATIVAS,
      },
    });
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
    await this.professores.registrarUsoIa(uid, 'isolateus', hoje);
    return { questoes, restantes: Math.max(0, limite - (usados + 1)) };
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
