import { BadRequestException } from '@nestjs/common';
import { CupomService } from './cupom.service';
import { CupomRepository } from './cupom.repository';
import { CupomEntity } from './entities/cupom.entity';
import { FirebaseService } from '../firebase/firebase.service';

describe('Cupom', () => {
  describe('CupomEntity', () => {
    it('normaliza o codigo em maiUsculas e sem espacos', () => {
      expect(CupomEntity.normalizar('  volta10 ')).toBe('VOLTA10');
    });

    it('estaValido respeita ativo e limite de usos', () => {
      expect(new CupomEntity({ ativo: true }).estaValido()).toBe(true);
      expect(new CupomEntity({ ativo: false }).estaValido()).toBe(false);
      expect(
        new CupomEntity({ ativo: true, usos: 5, maxUsos: 5 }).estaValido(),
      ).toBe(false);
      expect(
        new CupomEntity({ ativo: true, usos: 4, maxUsos: 5 }).estaValido(),
      ).toBe(true);
    });
  });

  describe('CupomService.aplicar', () => {
    let repo: jest.Mocked<Pick<CupomRepository, 'findByCodigo'>>;
    let txSet: jest.Mock;
    let txUpdate: jest.Mock;
    let firebase: FirebaseService;

    beforeEach(() => {
      repo = { findByCodigo: jest.fn() };
      txSet = jest.fn();
      txUpdate = jest.fn();
      const tx = {
        get: async () => ({ data: () => ({ usos: 0, ativo: true }) }),
        update: txUpdate,
        set: txSet,
      };
      firebase = {
        firestore: {
          runTransaction: async (fn: (t: unknown) => Promise<void>) => fn(tx),
          collection: () => ({ doc: () => ({}) }),
        },
      } as unknown as FirebaseService;
    });

    function service() {
      return new CupomService(repo as unknown as CupomRepository, firebase);
    }

    it('concede o plano e incrementa usos numa transacao', async () => {
      repo.findByCodigo.mockResolvedValue(
        new CupomEntity({
          id: 'c1',
          codigo: 'PHDGRATIS',
          tipo: 'PLANO_GRATIS',
          planoConcedido: 'PHD',
          ativo: true,
          usos: 0,
        }),
      );

      const res = await service().aplicar('u1', 'phdgratis');

      expect(res).toMatchObject({ aplicado: true, planoAtual: 'PHD' });
      expect(txUpdate).toHaveBeenCalledWith(expect.anything(), { usos: 1 });
      expect(txSet).toHaveBeenCalledWith(
        expect.anything(),
        { planoAtual: 'PHD' },
        { merge: true },
      );
    });

    it('define cortesiaAte para cupom de meses gratis', async () => {
      repo.findByCodigo.mockResolvedValue(
        new CupomEntity({
          id: 'c2',
          codigo: 'TRES',
          tipo: 'MESES_GRATIS',
          meses: 3,
          ativo: true,
        }),
      );

      const res = await service().aplicar('u1', 'TRES');
      expect(res.cortesiaAte).toBeDefined();
      expect(txSet).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ cortesiaAte: expect.any(String) }),
        { merge: true },
      );
    });

    it('rejeita cupom inexistente/invalido antes da transacao', async () => {
      repo.findByCodigo.mockResolvedValue(null);
      await expect(service().aplicar('u1', 'NAOEXISTE')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(txUpdate).not.toHaveBeenCalled();
    });
  });
});
