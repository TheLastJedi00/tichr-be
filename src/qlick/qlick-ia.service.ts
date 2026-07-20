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
import { GerarPerguntasDto } from './dto/gerar-perguntas.dto';
import { PerguntaQlick } from './entities/qlick.entity';

/** Quantidade de perguntas geradas por chamada e alternativas por pergunta. */
const QTD_PERGUNTAS = 10;
const QTD_ALTERNATIVAS = 4;

/**
 * Orquestra a geração de perguntas do Tichr Qlick por IA, com **rate limit de
 * 1×/dia por professor** (separado do Wor) e gate de plano **PhD**. Gera um lote
 * de {@link QTD_PERGUNTAS} perguntas de múltipla escolha; o professor edita depois.
 */
@Injectable()
export class QlickIaService {
  constructor(
    private readonly gemini: GeminiService,
    private readonly professores: ProfessorService,
    private readonly prompts: PromptIaService,
    private readonly configIa: ConfigIaService,
  ) {}

  async gerarPerguntas(
    uid: string,
    dto: GerarPerguntasDto,
  ): Promise<{ perguntas: PerguntaQlick[]; restantes: number }> {
    if (!this.gemini.disponivel()) {
      throw new ServiceUnavailableException({
        code: 'IA_INDISPONIVEL',
        message: 'Geração por IA indisponível. Você pode escrever as perguntas manualmente.',
      });
    }

    const hoje = new Date().toISOString().slice(0, 10);
    const prof = await this.professores.getProfile(uid);
    if (!prof.podeGamificar) {
      throw new ForbiddenException({
        code: 'QLICK_LOCKED',
        message: 'O Tichr Qlick é exclusivo do plano PhD.',
      });
    }
    const limite = await this.configIa.limiteGeracoesDia();
    const usados = prof.usosIaHoje('qlick', hoje);
    if (usados >= limite) {
      throw new HttpException(
        {
          code: 'IA_RATE_LIMIT',
          message:
            'Sua geração diária se esgotou! A IA cria perguntas um número limitado de vezes por dia. Você ainda pode escrever/editar as perguntas manualmente, ou voltar amanhã.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const prompt = await this.prompts.montar('qlick', {
      disciplina: dto.disciplina,
      topico: dto.topico,
      instrucao: dto.instrucao,
      quantidades: {
        qtdPerguntas: QTD_PERGUNTAS,
        qtdAlternativas: QTD_ALTERNATIVAS,
      },
    });
    const texto = await this.gemini.gerarTexto(prompt, {
      json: true,
      maxOutputTokens: 4096,
    });
    const perguntas = QlickIaService.extrairPerguntas(texto);
    if (perguntas.length === 0) {
      console.error(`[QlickIA] parse vazio. Trecho: ${texto.slice(0, 300)}`);
      throw new ServiceUnavailableException({
        code: 'IA_SEM_RESULTADO',
        message: 'A IA não retornou perguntas válidas. Tente novamente com outra descrição.',
      });
    }

    // Só consome a cota diária quando a IA respondeu com perguntas válidas.
    await this.professores.registrarUsoIa(uid, 'qlick', hoje);
    return { perguntas, restantes: Math.max(0, limite - (usados + 1)) };
  }

  /**
   * Parse robusto do JSON retornado pela IA. Mantém apenas perguntas válidas
   * (enunciado + 2..6 alternativas + corretaIndex no intervalo), corrige o índice
   * quando fora do range e limita a {@link QTD_PERGUNTAS}.
   */
  static extrairPerguntas(texto: string): PerguntaQlick[] {
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

    const perguntas: PerguntaQlick[] = [];
    for (const item of arr) {
      const p = item as {
        enunciado?: unknown;
        alternativas?: unknown;
        corretaIndex?: unknown;
      };
      const enunciado = String(p.enunciado ?? '').trim();
      const alternativas = Array.isArray(p.alternativas)
        ? p.alternativas.map((a) => String(a).trim()).filter(Boolean)
        : [];
      if (!enunciado || alternativas.length < 2) continue;
      const alts = alternativas.slice(0, 6);
      let corretaIndex = Number(p.corretaIndex);
      if (!Number.isInteger(corretaIndex) || corretaIndex < 0 || corretaIndex >= alts.length) {
        corretaIndex = 0;
      }
      perguntas.push({ enunciado, alternativas: alts, corretaIndex });
    }
    return perguntas.slice(0, QTD_PERGUNTAS);
  }
}
