import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ProfessorService } from '../professor/professor.service';
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
 * Orquestra a geração do arsenal do Tichr Wor por IA, com **rate limit de 1×/dia
 * por professor** (separado do Qlick) e gate de plano **PhD**. Gera um lote de
 * {@link QTD_PALAVRAS} palavras, cada uma com {@link QTD_DICAS} dicas
 * progressivas; o professor edita depois. Arsenal manual segue sempre disponível.
 */
@Injectable()
export class WorIaService {
  constructor(
    private readonly gemini: GeminiService,
    private readonly professores: ProfessorService,
  ) {}

  async gerarArsenal(
    uid: string,
    dto: GerarArsenalDto,
  ): Promise<{ palavras: PalavraGerada[] }> {
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
    if (prof.usouIaWorHoje(hoje)) {
      throw new HttpException(
        {
          code: 'IA_RATE_LIMIT',
          message:
            'Sua magia diária se esgotou! Para manter a performance, a IA forja o arsenal 1 vez por dia. Escreva suas próprias palavras e dicas, ou volte amanhã.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const texto = await this.gemini.gerarTexto(WorIaService.montarPrompt(dto), {
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
    await this.professores.marcarUsoIaWor(uid);
    return { palavras };
  }

  /** Monta o prompt do arsenal com o contexto (disciplina/tópico) + instrução do professor. */
  private static montarPrompt(dto: GerarArsenalDto): string {
    return [
      'Você cria palavras secretas e dicas para um jogo de adivinhação (estilo forca) em português do Brasil, para uso em sala de aula.',
      dto.disciplina ? `Disciplina: ${dto.disciplina}.` : '',
      dto.topico ? `Tópico da aula: ${dto.topico}.` : '',
      `Instruções do professor: ${dto.instrucao}`,
      `Gere EXATAMENTE ${QTD_PALAVRAS} palavras secretas, cada uma com ${QTD_DICAS} dicas progressivas, da MAIS DIFÍCIL (1) para a MAIS FÁCIL (3).`,
      'Cada palavra deve ser um termo único (sem espaços, acentos ou hífens), com no máximo 40 letras.',
      'As dicas NÃO podem conter a própria palavra secreta.',
      'Responda SOMENTE com um array JSON, sem markdown, no formato:',
      '[{"palavra":"GUILHOTINA","dicas":["dica 1","dica 2","dica 3"]}]',
    ]
      .filter(Boolean)
      .join('\n');
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
