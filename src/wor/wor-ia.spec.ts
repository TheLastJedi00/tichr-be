import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { WorIaService } from './wor-ia.service';
import { ProfessorService } from '../professor/professor.service';
import { ProfessorEntity } from '../professor/entities/professor.entity';

describe('IA de dicas do Wor', () => {
  describe('GeminiService.extrairDicas', () => {
    it('parseia um array JSON e limita a 3', () => {
      const r = GeminiService.extrairDicas('lixo ["a","b","c","d"] fim');
      expect(r).toEqual(['a', 'b', 'c']);
    });

    it('cai para quebra por linhas quando não há JSON', () => {
      const r = GeminiService.extrairDicas('1. primeira\n2) segunda\n- terceira');
      expect(r).toEqual(['primeira', 'segunda', 'terceira']);
    });
  });

  describe('WorIaService (rate limit)', () => {
    const hoje = new Date().toISOString().slice(0, 10);

    function make(opts: {
      disponivel: boolean;
      usouHoje: boolean;
    }) {
      const gemini = {
        disponivel: () => opts.disponivel,
        gerarDicas: jest.fn().mockResolvedValue(['a', 'b', 'c']),
      } as unknown as GeminiService;
      const prof = new ProfessorEntity({
        uid: 'u1',
        worIaUltimoUso: opts.usouHoje ? `${hoje}T10:00:00.000Z` : undefined,
      });
      const marcar = jest.fn().mockResolvedValue(undefined);
      const professores = {
        getProfile: jest.fn().mockResolvedValue(prof),
        marcarUsoIaWor: marcar,
      } as unknown as ProfessorService;
      return {
        service: new WorIaService(gemini, professores),
        gemini,
        marcar,
      };
    }

    it('503 quando a IA está indisponível (sem chave)', async () => {
      const { service } = make({ disponivel: false, usouHoje: false });
      await expect(
        service.gerarDicas('u1', { topico: 't', palavra: 'rei' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('429 quando já usou hoje', async () => {
      const { service, marcar } = make({ disponivel: true, usouHoje: true });
      await expect(
        service.gerarDicas('u1', { topico: 't', palavra: 'rei' }),
      ).rejects.toMatchObject({ response: { code: 'IA_RATE_LIMIT' } });
      expect(marcar).not.toHaveBeenCalled();
    });

    it('gera e marca o uso quando liberado', async () => {
      const { service, gemini, marcar } = make({ disponivel: true, usouHoje: false });
      const r = await service.gerarDicas('u1', {
        topico: 'Revolução Francesa',
        palavra: 'guilhotina',
        disciplina: 'História',
      });
      expect(r.dicas).toEqual(['a', 'b', 'c']);
      expect(gemini.gerarDicas).toHaveBeenCalledWith(
        'Revolução Francesa',
        'guilhotina',
        'História',
      );
      expect(marcar).toHaveBeenCalledWith('u1');
    });

    it('lança HttpException (429) tipada no rate limit', async () => {
      const { service } = make({ disponivel: true, usouHoje: true });
      await expect(
        service.gerarDicas('u1', { topico: 't', palavra: 'rei' }),
      ).rejects.toBeInstanceOf(HttpException);
    });
  });
});
