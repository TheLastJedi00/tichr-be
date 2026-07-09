import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';

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
    topico: string | undefined,
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
      topico ? `Tópico da aula: ${topico}.` : '',
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

  /**
   * Chamada genérica: envia um prompt e devolve o texto bruto do modelo. Códigos
   * de 503 distintos para diagnóstico (`IA_SEM_CHAVE` / `IA_UPSTREAM`) e o motivo
   * real do upstream é logado (visível nos logs do servidor). `opts.json` força a
   * saída em JSON puro (structured output) e `maxOutputTokens` evita truncamento.
   */
  async gerarTexto(
    prompt: string,
    opts?: { json?: boolean; maxOutputTokens?: number },
  ): Promise<string> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: 'IA_SEM_CHAVE',
        message: 'Geração por IA indisponível (chave não configurada no servidor).',
      });
    }

    const generationConfig: Record<string, unknown> = {
      temperature: 0.7,
      maxOutputTokens: opts?.maxOutputTokens ?? 4096,
    };
    if (opts?.json) {
      generationConfig.responseMimeType = 'application/json';
    }

    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      }),
    });

    if (!res.ok) {
      const detalhe = await res.text().catch(() => '');
      console.error(`[Gemini] HTTP ${res.status}: ${detalhe.slice(0, 400)}`);
      throw new ServiceUnavailableException({
        code: 'IA_UPSTREAM',
        message: 'A IA não respondeu. Tente novamente mais tarde.',
      });
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
    };
    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!texto) {
      const finish = data.candidates?.[0]?.finishReason ?? '?';
      const block = data.promptFeedback?.blockReason ?? '-';
      console.error(`[Gemini] resposta vazia (finishReason=${finish}, block=${block})`);
    }
    return texto;
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
