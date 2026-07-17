import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../firebase/firebase.service';
import { ProfessorEntity } from '../professor/entities/professor.entity';
import { ProfessorService } from '../professor/professor.service';
import { AbacatePayService } from './abacate-pay.service';
import { CheckoutService } from './checkout.service';
import { CobrancaRepository } from './cobranca.repository';

describe('CheckoutService', () => {
  let abacate: jest.Mocked<
    Pick<
      AbacatePayService,
      'criarCobrancaPix' | 'criarCheckoutCartao' | 'simularPagamentoPix' | 'devMode'
    >
  >;
  let cobrancas: jest.Mocked<Pick<CobrancaRepository, 'salvar' | 'findById' | 'update'>>;
  let professores: jest.Mocked<
    Pick<ProfessorService, 'getProfile' | 'alterarPlano' | 'comprarSlotAvulso' | 'registrarBillingAtual'>
  >;
  let txSet: jest.Mock;
  let txUpdate: jest.Mock;
  let cobData: Record<string, unknown>;
  let firebase: FirebaseService;

  beforeEach(() => {
    abacate = {
      criarCobrancaPix: jest.fn(),
      criarCheckoutCartao: jest.fn(),
      simularPagamentoPix: jest.fn(),
      devMode: true,
    } as never;
    cobrancas = {
      salvar: jest.fn(async (c) => c),
      findById: jest.fn(),
      update: jest.fn(),
    };
    professores = {
      getProfile: jest.fn(),
      alterarPlano: jest.fn(),
      comprarSlotAvulso: jest.fn(),
      registrarBillingAtual: jest.fn(),
    };

    txSet = jest.fn();
    txUpdate = jest.fn();
    cobData = {
      status: 'PENDING',
      tipo: 'UPGRADE',
      planoAlvo: 'MESTRE',
      professorId: 'u1',
    };
    const tx = {
      get: async (ref: { kind: string }) =>
        ref.kind === 'cobrancas'
          ? { exists: true, data: () => cobData }
          : { exists: true, data: () => ({}) },
      set: txSet,
      update: txUpdate,
    };
    firebase = {
      firestore: {
        runTransaction: async (fn: (t: unknown) => Promise<void>) => fn(tx),
        collection: (kind: string) => ({ doc: () => ({ kind }) }),
      },
    } as unknown as FirebaseService;
  });

  function service() {
    return new CheckoutService(
      abacate as unknown as AbacatePayService,
      cobrancas as unknown as CobrancaRepository,
      professores as unknown as ProfessorService,
      firebase,
      { get: () => 'http://localhost:4200' } as unknown as ConfigService,
    );
  }

  it('admin troca de plano sem passar pelo gateway', async () => {
    professores.getProfile.mockResolvedValue(
      new ProfessorEntity({ uid: 'admin', isAdmin: true }),
    );

    const res = await service().iniciarUpgrade('admin', {
      plano: 'PHD',
      metodo: 'PIX',
    });

    expect(res).toEqual({ concedido: true });
    expect(professores.alterarPlano).toHaveBeenCalledWith('admin', 'PHD');
    expect(abacate.criarCobrancaPix).not.toHaveBeenCalled();
  });

  it('upgrade normal cria cobranca PIX e NAO muda o plano', async () => {
    professores.getProfile.mockResolvedValue(new ProfessorEntity({ uid: 'u1' }));
    abacate.criarCobrancaPix.mockResolvedValue({
      id: 'pix_1',
      brCode: '000201...',
      brCodeBase64: 'iVBOR...',
      status: 'PENDING',
    });

    const res = await service().iniciarUpgrade('u1', {
      plano: 'MESTRE',
      metodo: 'PIX',
    });

    expect(res.billingId).toBe('pix_1');
    expect(res.brCode).toBe('000201...');
    expect(res.status).toBe('PENDING');
    expect(cobrancas.salvar).toHaveBeenCalled();
    expect(professores.registrarBillingAtual).toHaveBeenCalledWith('u1', 'pix_1');
    expect(professores.alterarPlano).not.toHaveBeenCalled();
  });

  it('webhook billing.paid concede o plano com vencimento e statusAssinatura ATIVA', async () => {
    await service().processarWebhook({
      event: 'billing.paid',
      data: { pixQrCode: { id: 'pix_1' } },
    });

    expect(txSet).toHaveBeenCalledTimes(1);
    const [, update] = txSet.mock.calls[0];
    expect(update).toMatchObject({
      planoAtual: 'MESTRE',
      statusAssinatura: 'ATIVA',
      assinaturaAte: expect.any(String),
    });
    expect(txUpdate).toHaveBeenCalledWith(expect.anything(), {
      status: 'PAID',
      pagoEm: expect.any(String),
    });
  });

  it('webhook repetido nao credita de novo (idempotencia)', async () => {
    cobData.status = 'PAID'; // ja processado
    await service().processarWebhook({
      event: 'billing.paid',
      data: { pixQrCode: { id: 'pix_1' } },
    });
    expect(txSet).not.toHaveBeenCalled();
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('webhook de SLOT incrementa a vaga avulsa', async () => {
    cobData.tipo = 'SLOT';
    delete cobData.planoAlvo;
    await service().processarWebhook({
      event: 'billing.paid',
      data: { billing: { id: 'chk_1' } },
    });
    const [, update] = txSet.mock.calls[0];
    expect(update).toEqual({ slotsAdicionaisComprados: 1 });
  });

  it('simular exige devMode e credita a cobranca PIX', async () => {
    cobrancas.findById.mockResolvedValue({
      id: 'pix_1',
      professorId: 'u1',
      metodo: 'PIX',
      status: 'PENDING',
    } as never);
    abacate.simularPagamentoPix.mockResolvedValue('PAID');

    const res = await service().simular('u1', 'pix_1');
    expect(res).toEqual({ status: 'PAID' });
    expect(abacate.simularPagamentoPix).toHaveBeenCalledWith('pix_1');
    expect(txSet).toHaveBeenCalled();
  });
});
