import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GEMINI_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';
/**
 * Modelo padrão quando `GEMINI_MODEL` não está no ambiente. `gemini-2.5-flash`
 * é um id válido e vigente na API v1beta — o antigo `gemini-3.5-flash` NÃO
 * existe, então todo generateContent voltava 404 (503 `IA_UPSTREAM`) e a geração
 * por IA ficava quebrada nos três jogos (Qlick/Wor/Isolateus).
 */
const GEMINI_MODEL_PADRAO = 'gemini-2.5-flash';

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

  /** Endpoint do modelo configurado (`GEMINI_MODEL`) ou o padrão. */
  private endpoint(): string {
    const modelo =
      this.config.get<string>('GEMINI_MODEL')?.trim() || GEMINI_MODEL_PADRAO;
    return `${GEMINI_BASE}/${modelo}:generateContent`;
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

    const res = await fetch(`${this.endpoint()}?key=${apiKey}`, {
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
}
