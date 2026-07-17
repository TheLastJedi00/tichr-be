import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

/**
 * Superfície mínima do client v2 do `@abacatepay/sdk` que consumimos. O SDK é
 * fortemente tipado, mas tem quirks conhecidos nos tipos (ex.: `metadata` como
 * `Record<string, object>`); tipamos aqui só o que usamos e fazemos o cast no
 * ponto de chamada. O client v2 já desembrulha `{ data, error }` e lança em erro.
 */
interface AbacateClient {
  pix: {
    create(body: Record<string, unknown>): Promise<{
      id: string;
      brCode: string;
      brCodeBase64: string;
      status: StatusPagamento;
      expiresAt?: string;
    }>;
    simulate(id: string): Promise<{ status: StatusPagamento }>;
    status(id: string): Promise<{ status: StatusPagamento }>;
  };
  checkouts: {
    create(body: Record<string, unknown>): Promise<{
      id: string;
      url: string;
      status: StatusPagamento;
    }>;
    get(id: string): Promise<{ status: StatusPagamento }>;
  };
  coupons: {
    create(body: Record<string, unknown>): Promise<{ id: string; status: string }>;
  };
  products: {
    create(body: Record<string, unknown>): Promise<{ id: string }>;
    get(query: Record<string, unknown>): Promise<{ id: string } | null>;
  };
}

/**
 * Integração com a Abacate Pay via SDK oficial novo (`@abacatepay/sdk`, v2). A
 * chave (`ABACATE_API_KEY`) fica no ambiente (Vercel em produção); sem chave,
 * `disponivel()` é falso e o chamador trata como indisponível.
 *
 * O SDK é **ESM-only** (`"type": "module"`) e o backend compila para CommonJS —
 * por isso o client é carregado via `import()` dinâmico (preservado nativo pelo
 * `module: nodenext`), inicializado uma vez e cacheado. Segue o mesmo molde de
 * integração externa do `GeminiService`: `ConfigService` + erro upstream em 503.
 */
@Injectable()
export class AbacatePayService {
  /** Client já inicializado (cacheado — o SDK é carregado uma única vez). */
  private clientePromise?: Promise<AbacateClient>;
  /** externalId do produto → id interno na Abacate (evita recriar no cartão). */
  private readonly produtoCache = new Map<string, string>();

  constructor(private readonly config: ConfigService) {}

  /** Verdadeiro se a chave da Abacate está configurada no ambiente. */
  disponivel(): boolean {
    return !!this.config.get<string>('ABACATE_API_KEY');
  }

  /**
   * Ambiente de testes do gateway (permite `simulate` de pagamento). Default
   * `true`; só vira produção com `ABACATE_DEV_MODE='false'` no ambiente.
   */
  get devMode(): boolean {
    return this.config.get<string>('ABACATE_DEV_MODE') !== 'false';
  }

  private async client(): Promise<AbacateClient> {
    const secret = this.config.get<string>('ABACATE_API_KEY');
    if (!secret) {
      throw new ServiceUnavailableException({
        code: 'PAGAMENTO_SEM_CHAVE',
        message: 'Pagamento indisponível (chave não configurada no servidor).',
      });
    }
    if (!this.clientePromise) {
      this.clientePromise = import('@abacatepay/sdk').then((m) =>
        (m.AbacatePay as (o: { secret: string }) => AbacateClient)({ secret }),
      );
    }
    return this.clientePromise;
  }

  /** Executa uma chamada ao gateway normalizando o erro upstream em 503. */
  private async chamar<T>(fn: (c: AbacateClient) => Promise<T>): Promise<T> {
    const client = await this.client();
    try {
      return await fn(client);
    } catch (e) {
      const detalhe = e instanceof Error ? e.message : String(e);
      console.error(`[AbacatePay] falha upstream: ${detalhe}`);
      throw new ServiceUnavailableException({
        code: 'PAGAMENTO_UPSTREAM',
        message: 'O provedor de pagamento não respondeu. Tente novamente.',
      });
    }
  }

  /** Cria uma cobrança PIX de valor único (retorna QR + copia-e-cola). */
  async criarCobrancaPix(input: {
    valorCentavos: number;
    descricao: string;
    expiraEmSegundos?: number;
    metadata?: Record<string, unknown>;
  }): Promise<CobrancaPix> {
    const pix = await this.chamar((c) =>
      c.pix.create({
        amount: input.valorCentavos,
        description: input.descricao,
        expiresIn: input.expiraEmSegundos ?? 60 * 30,
        metadata: input.metadata,
      }),
    );
    return {
      id: pix.id,
      brCode: pix.brCode,
      brCodeBase64: pix.brCodeBase64,
      status: pix.status,
      expiraEm: pix.expiresAt,
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
    const checkout = await this.chamar((c) =>
      c.checkouts.create({
        methods: 'CARD',
        items: [{ id: produtoId, quantity: 1 }],
        returnUrl: input.returnUrl,
        completionUrl: input.completionUrl,
        externalId: input.professorId,
        ...(input.cupons?.length ? { coupons: input.cupons } : {}),
      }),
    );
    return { id: checkout.id, url: checkout.url, status: checkout.status };
  }

  /** Consulta o status de uma cobrança PIX. */
  async consultarStatusPix(id: string): Promise<StatusPagamento> {
    return (await this.chamar((c) => c.pix.status(id))).status;
  }

  /** Consulta o status de um checkout (cartão). */
  async consultarStatusCheckout(id: string): Promise<StatusPagamento> {
    return (await this.chamar((c) => c.checkouts.get(id))).status;
  }

  /** Simula o pagamento de uma cobrança PIX (só em devMode). */
  async simularPagamentoPix(id: string): Promise<StatusPagamento> {
    return (await this.chamar((c) => c.pix.simulate(id))).status;
  }

  /** Cria um cupom real no gateway (espelho do cupom criado pelo admin). */
  async criarCupom(input: {
    codigo: string;
    discount: number;
    discountKind: 'PERCENTAGE' | 'FIXED';
    notes?: string;
    maxRedeems?: number;
  }): Promise<CupomGateway> {
    const cupom = await this.chamar((c) =>
      c.coupons.create({
        code: input.codigo,
        discount: input.discount,
        discountKind: input.discountKind,
        notes: input.notes,
        maxRedeems: input.maxRedeems ?? -1,
      }),
    );
    return { id: cupom.id, status: cupom.status };
  }

  /** Garante um produto no catálogo do gateway por `externalId` (cacheado). */
  private async garantirProduto(
    externalId: string,
    nome: string,
    valorCentavos: number,
  ): Promise<string> {
    const cacheado = this.produtoCache.get(externalId);
    if (cacheado) return cacheado;

    const id = await this.chamar(async (c) => {
      try {
        const achado = await c.products.get({ externalId });
        if (achado?.id) return achado.id;
      } catch {
        // Produto ainda não existe — cria abaixo.
      }
      const criado = await c.products.create({
        externalId,
        name: nome,
        price: valorCentavos,
        currency: 'BRL',
      });
      return criado.id;
    });

    this.produtoCache.set(externalId, id);
    return id;
  }
}
