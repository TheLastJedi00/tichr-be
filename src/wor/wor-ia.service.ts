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
import { GeminiService } from './gemini.service';
import { GerarArsenalDto } from './dto/gerar-arsenal.dto';

/** Quantidade de palavras geradas por chamada e de dicas por palavra. */
const QTD_PALAVRAS = 5;
const QTD_DICAS = 3;

/** Palavra secreta com suas dicas, do jeito que a IA devolve (sem id ainda). */
export interface PalavraGerada {
  palavra: string;
  dicas: string[];
}

/**
 * Orquestra a geração do arsenal do Tichr Wor por IA, com **rate limit diário
 * configurável** (limite global em `config/ia`, contador por professor/jogo) e
 * gate de plano **PhD**. Gera um lote de {@link QTD_PALAVRAS} palavras, cada uma
 * com {@link QTD_DICAS} dicas progressivas; o professor edita depois. O prompt
 * vem do {@link PromptIaService} (editável pelo admin). Arsenal manual sempre livre.
 */
@Injectable()
export class WorIaService {
  constructor(
    private readonly gemini: GeminiService,
    private readonly professores: ProfessorService,
    private readonly prompts: PromptIaService,
    private readonly configIa: ConfigIaService,
  ) {}

  async gerarArsenal(
    uid: string,
    dto: GerarArsenalDto,
  ): Promise<{ palavras: PalavraGerada[]; restantes: number }> {
    if (!this.gemini.disponivel()) {
      throw new ServiceUnavailableException({
        code: 'IA_INDISPONIVEL',
        message:
          'Geração por IA indisponível. Você pode escrever as palavras e dicas manualmente.',
      });
    }

    const hoje = new Date().toISOString().slice(0, 10);
    const prof = await this.professores.getProfile(uid);
    if (!prof.podeGamificar) {
      throw new ForbiddenException({
        code: 'WOR_LOCKED',
        message: 'O Tichr Wor é exclusivo do plano PhD.',
      });
    }
    const limite = await this.configIa.limiteGeracoesDia();
    const usados = prof.usosIaHoje('wor', hoje);
    if (usados >= limite) {
      throw new HttpException(
        {
          code: 'IA_RATE_LIMIT',
          message:
            'Sua magia diária se esgotou! Para manter a performance, a IA forja o arsenal um número limitado de vezes por dia. Escreva suas próprias palavras e dicas, ou volte amanhã.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const prompt = await this.prompts.montar('wor', {
      disciplina: dto.disciplina,
      topico: dto.topico,
      instrucao: dto.instrucao,
      quantidades: { qtdPalavras: QTD_PALAVRAS, qtdDicas: QTD_DICAS },
    });
    const texto = await this.gemini.gerarTexto(prompt, {
      json: true,
      maxOutputTokens: 2048,
    });
    const palavras = WorIaService.extrairArsenal(texto);
    if (palavras.length === 0) {
      console.error(`[WorIA] parse vazio. Trecho: ${texto.slice(0, 300)}`);
      throw new ServiceUnavailableException({
        code: 'IA_SEM_RESULTADO',
        message:
          'A IA não retornou palavras válidas. Tente novamente com outra descrição.',
      });
    }

    // Só consome a cota diária quando a IA respondeu com um arsenal válido.
    await this.professores.registrarUsoIa(uid, 'wor', hoje);
    return { palavras, restantes: Math.max(0, limite - (usados + 1)) };
  }

  /**
   * Parse robusto do JSON retornado pela IA. Mantém apenas palavras válidas
   * (termo não vazio + ao menos 1 dica), apara o texto, limita a {@link QTD_DICAS}
   * dicas por palavra e a {@link QTD_PALAVRAS} palavras.
   */
  static extrairArsenal(texto: string): PalavraGerada[] {
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

    const palavras: PalavraGerada[] = [];
    for (const item of arr) {
      const p = item as { palavra?: unknown; dicas?: unknown };
      const palavra = String(p.palavra ?? '')
        .trim()
        .slice(0, 40);
      const dicas = Array.isArray(p.dicas)
        ? p.dicas
            .map((d) => String(d).trim())
            .filter(Boolean)
            .slice(0, QTD_DICAS)
        : [];
      if (!palavra || dicas.length === 0) continue;
      palavras.push({ palavra, dicas });
    }
    return palavras.slice(0, QTD_PALAVRAS);
  }
}
