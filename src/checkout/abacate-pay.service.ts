import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Base da API v2 da Abacate Pay. */
const API_BASE = 'https://api.abacatepay.com/v2';

/** Status de um pagamento na Abacate Pay (espelha o enum do gateway). */
export type StatusPagamento =
  | 'PENDING'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'PAID'
  | 'REFUNDED';

/** Cobrança PIX criada: QR (base64) + copia-e-cola para o cliente pagar no app. */
export interface CobrancaPix {
  id: string;
  brCode: string;
  brCodeBase64: string;
  status: StatusPagamento;
  expiraEm?: string;
}

/** Checkout hospedado (cartão): o cliente é redirecionado para `url`. */
export interface CheckoutCartao {
  id: string;
  url: string;
  status: StatusPagamento;
}

/** Cupom espelhado no gateway. */
export interface CupomGateway {
  id: string;
  status: string;
}

/** Envelope padrão de resposta da API (`{ success, data, error }`). */
interface RespostaApi<T> {
  success?: boolean;
  data?: T;
  error?: string | null;
}

/**
 * Integração com a Abacate Pay (API v2) via REST (`fetch`), no mesmo molde de
 * integração externa do projeto (`GeminiService`/`resend`): `ConfigService` para
 * a chave (`ABACATE_API_KEY`) + `fetch` + erro upstream em 503.
 *
 * **Por que REST e não o SDK `@abacatepay/sdk`:** o SDK (v2) envia o corpo do
 * PIX achatado (`{ amount }`), mas a API v2 exige `{ method: 'PIX', data: {…} }`
 * — o SDK responde 422 contra a API ao vivo (verificado em devMode). Chamamos a
 * REST diretamente, que é o padrão já usado em Gemini/Resend/Identity Toolkit.
 *
 * Endpoints v2 (todos com resposta `{ success, data, error }`):
 * - PIX:     `POST /transparents/create` `{ method:'PIX', data:{ amount, … } }`,
 *            `GET /transparents/check?id=`, `POST /transparents/simulate-payment?id=`
 * - Cartão:  `POST /products/create` → id; `POST /checkouts/create`
 *            `{ methods:['CARD'], items:[{ id, quantity }], … }`; `GET /checkouts/get?id=`
 * - Cupom:   `POST /coupons/create` `{ code, discount, discountKind, … }`
 */
@Injectable()
export class AbacatePayService {
  /** externalId do produto → id interno na Abacate (evita recriar no cartão). */
  private readonly produtoCache = new Map<string, string>();

  constructor(private readonly config: ConfigService) {}

  /** Verdadeiro se a chave da Abacate está configurada no ambiente. */
  disponivel(): boolean {
    return !!this.config.get<string>('ABACATE_API_KEY');
  }

  /**
   * Ambiente de testes do gateway (permite `simulate` de pagamento). Default
   * `true`; só vira produção com `ABACATE_DEV_MODE='false'`. **Observação:** o
   * ambiente real (teste × produção) é definido pela própria chave (`abc_dev_` ×
   * `abc_prod_`); este flag apenas libera/oculta o endpoint de simulação no app.
   */
  get devMode(): boolean {
    return this.config.get<string>('ABACATE_DEV_MODE') !== 'false';
  }

  /** Chamada REST autenticada; normaliza o envelope e o erro upstream em 503. */
  private async req<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const key = this.config.get<string>('ABACATE_API_KEY');
    if (!key) {
      throw new ServiceUnavailableException({
        code: 'PAGAMENTO_SEM_CHAVE',
        message: 'Pagamento indisponível (chave não configurada no servidor).',
      });
    }

    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      const detalhe = e instanceof Error ? e.message : String(e);
      console.error(`[AbacatePay] rede ${method} ${path}: ${detalhe}`);
      throw this.upstream();
    }

    const json = (await res.json().catch(() => null)) as RespostaApi<T> | null;
    if (!res.ok || !json || json.success === false || json.error) {
      console.error(
        `[AbacatePay] ${method} ${path} -> ${res.status} ${json?.error ?? ''}`,
      );
      throw this.upstream();
    }
    return json.data as T;
  }

  private upstream(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'PAGAMENTO_UPSTREAM',
      message: 'O provedor de pagamento não respondeu. Tente novamente.',
    });
  }

  /** Cria uma cobrança PIX de valor único (retorna QR + copia-e-cola). */
  async criarCobrancaPix(input: {
    valorCentavos: number;
    descricao: string;
    expiraEmSegundos?: number;
    metadata?: Record<string, unknown>;
  }): Promise<CobrancaPix> {
    const d = await this.req<{
      id: string;
      brCode: string;
      brCodeBase64: string;
      status: StatusPagamento;
      expiresAt?: string;
    }>('POST', '/transparents/create', {
      method: 'PIX',
      data: {
        amount: input.valorCentavos,
        description: input.descricao,
        expiresIn: input.expiraEmSegundos ?? 60 * 30,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    });
    return {
      id: d.id,
      brCode: d.brCode,
      brCodeBase64: d.brCodeBase64,
      status: d.status,
      expiraEm: d.expiresAt,
    };
  }

  /**
   * Cria um checkout hospedado para pagamento com cartão. O checkout v2 exige
   * produtos cadastrados (`items:[{id}]`), então garantimos o produto do SKU
   * antes (idempotente por `externalId`).
   */
  async criarCheckoutCartao(input: {
    produtoExternalId: string;
    nome: string;
    valorCentavos: number;
    professorId: string;
    returnUrl: string;
    completionUrl: string;
    cupons?: string[];
  }): Promise<CheckoutCartao> {
    const produtoId = await this.garantirProduto(
      input.produtoExternalId,
      input.nome,
      input.valorCentavos,
    );
    const d = await this.req<{ id: string; url: string; status: StatusPagamento }>(
      'POST',
      '/checkouts/create',
      {
        methods: ['CARD'],
        items: [{ id: produtoId, quantity: 1 }],
        returnUrl: input.returnUrl,
        completionUrl: input.completionUrl,
        externalId: input.professorId,
        ...(input.cupons?.length ? { coupons: input.cupons } : {}),
      },
    );
    return { id: d.id, url: d.url, status: d.status };
  }

  /** Consulta o status de uma cobrança PIX. */
  async consultarStatusPix(id: string): Promise<StatusPagamento> {
    const d = await this.req<{ status: StatusPagamento }>(
      'GET',
      `/transparents/check?id=${encodeURIComponent(id)}`,
    );
    return d.status;
  }

  /** Consulta o status de um checkout (cartão). */
  async consultarStatusCheckout(id: string): Promise<StatusPagamento> {
    const d = await this.req<{ status: StatusPagamento }>(
      'GET',
      `/checkouts/get?id=${encodeURIComponent(id)}`,
    );
    return d.status;
  }

  /** Simula o pagamento de uma cobrança PIX (só em devMode). */
  async simularPagamentoPix(id: string): Promise<StatusPagamento> {
    const d = await this.req<{ status: StatusPagamento }>(
      'POST',
      `/transparents/simulate-payment?id=${encodeURIComponent(id)}`,
      {},
    );
    return d.status;
  }

  /** Cria um cupom real no gateway (espelho do cupom criado pelo admin). */
  async criarCupom(input: {
    codigo: string;
    discount: number;
    discountKind: 'PERCENTAGE' | 'FIXED';
    notes?: string;
    maxRedeems?: number;
  }): Promise<CupomGateway> {
    const d = await this.req<{ id: string; status: string }>(
      'POST',
      '/coupons/create',
      {
        code: input.codigo,
        discount: input.discount,
        discountKind: input.discountKind,
        notes: input.notes,
        maxRedeems: input.maxRedeems ?? -1,
      },
    );
    return { id: d.id, status: d.status };
  }

  /** Garante um produto no catálogo do gateway por `externalId` (cacheado). */
  private async garantirProduto(
    externalId: string,
    nome: string,
    valorCentavos: number,
  ): Promise<string> {
    const cacheado = this.produtoCache.get(externalId);
    if (cacheado) return cacheado;

    let id: string | undefined;
    try {
      const achado = await this.req<{ id: string }>(
        'GET',
        `/products/get?externalId=${encodeURIComponent(externalId)}`,
      );
      id = achado?.id;
    } catch {
      // Produto ainda não existe — cria abaixo.
    }
    if (!id) {
      const criado = await this.req<{ id: string }>('POST', '/products/create', {
        externalId,
        name: nome,
        price: valorCentavos,
        currency: 'BRL',
      });
      id = criado.id;
    }

    this.produtoCache.set(externalId, id);
    return id;
  }
}
