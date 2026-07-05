import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/**
 * Provedor de IA (Gemini). Abstrai a REST do Google. A chave (`GEMINI_API_KEY`)
 * fica no ambiente (Vercel em produção); sem chave, `disponivel()` é falso e o
 * chamador deve tratar como indisponível (fallback para dicas manuais).
 */
@Injectable()
export class GeminiService {
  constructor(private readonly config: ConfigService) {}

  disponivel(): boolean {
    return !!this.config.get<string>('GEMINI_API_KEY');
  }

  /**
   * Gera 3 dicas (da mais difícil para a mais fácil) para uma palavra secreta,
   * usando o tópico/disciplina como contexto. Retorna sempre um array de 3.
   */
  async gerarDicas(
    topico: string,
    palavra: string,
    disciplina?: string,
  ): Promise<string[]> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: 'IA_INDISPONIVEL',
        message: 'Geração por IA indisponível no momento.',
      });
    }

    const prompt = [
      'Você cria dicas para um jogo de adivinhação de palavras (estilo forca) em português do Brasil.',
      disciplina ? `Disciplina: ${disciplina}.` : '',
      `Tópico da aula: ${topico}.`,
      `Palavra secreta: "${palavra}".`,
      'Gere EXATAMENTE 3 dicas progressivas, da MAIS DIFÍCIL (1) para a MAIS FÁCIL (3).',
      'As dicas NÃO podem conter a própria palavra secreta.',
      'Responda SOMENTE com um array JSON de 3 strings, sem markdown. Ex: ["dica 1","dica 2","dica 3"]',
    ]
      .filter(Boolean)
      .join('\n');

    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 },
      }),
    });

    if (!res.ok) {
      throw new ServiceUnavailableException({
        code: 'IA_INDISPONIVEL',
        message: 'A IA não respondeu. Tente novamente ou escreva as dicas manualmente.',
      });
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return GeminiService.extrairDicas(texto);
  }

  /** Parse robusto: tenta JSON; senão quebra por linhas. Garante 3 itens. */
  static extrairDicas(texto: string): string[] {
    let itens: string[] = [];
    const jsonMatch = texto.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const arr = JSON.parse(jsonMatch[0]) as unknown[];
        itens = arr.map((x) => String(x).trim()).filter(Boolean);
      } catch {
        // cai no fallback de linhas
      }
    }
    if (itens.length === 0) {
      itens = texto
        .split('\n')
        .map((l) => l.replace(/^\s*(\d+[.)-]|[-*])\s*/, '').trim())
        .filter(Boolean);
    }
    return itens.slice(0, 3);
  }
}
