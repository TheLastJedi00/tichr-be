import {
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { WorIaService } from './wor-ia.service';
import { ProfessorService } from '../professor/professor.service';
import { ProfessorEntity } from '../professor/entities/professor.entity';

describe('IA do arsenal do Wor', () => {
  describe('WorIaService.extrairArsenal', () => {
    it('parseia o array JSON e limita a 5 palavras e 3 dicas', () => {
      const arr = Array.from({ length: 6 }, (_, i) => ({
        palavra: `P${i}`,
        dicas: ['a', 'b', 'c', 'd'],
      }));
      const r = WorIaService.extrairArsenal(JSON.stringify(arr));
      expect(r).toHaveLength(5);
      expect(r[0]).toEqual({ palavra: 'P0', dicas: ['a', 'b', 'c'] });
    });

    it('ignora cercas markdown e itens sem palavra ou sem dicas', () => {
      const texto =
        '```json\n[{"palavra":"","dicas":["a"]},{"palavra":"REI","dicas":[]},{"palavra":"GUILHOTINA","dicas":["x","y","z"]}]\n```';
      expect(WorIaService.extrairArsenal(texto)).toEqual([
        { palavra: 'GUILHOTINA', dicas: ['x', 'y', 'z'] },
      ]);
    });

    it('devolve vazio quando não há JSON parseável', () => {
      expect(WorIaService.extrairArsenal('desculpe, não consegui')).toEqual([]);
    });
  });

  describe('WorIaService (plano e rate limit)', () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const dto = { instrucao: 'termos da Revolução Francesa', disciplina: 'História' };
    const resposta = JSON.stringify([
      { palavra: 'GUILHOTINA', dicas: ['a', 'b', 'c'] },
    ]);

    function make(opts: {
      disponivel: boolean;
      usouHoje: boolean;
      phd?: boolean;
      texto?: string;
    }) {
      const gemini = {
        disponivel: () => opts.disponivel,
        gerarTexto: jest.fn().mockResolvedValue(opts.texto ?? resposta),
      } as unknown as GeminiService;
      const prof = new ProfessorEntity({
        uid: 'u1',
        planoAtual: opts.phd === false ? 'ESTAGIARIO' : 'PHD',
        worIaUltimoUso: opts.usouHoje ? `${hoje}T10:00:00.000Z` : undefined,
      });
      const marcar = jest.fn().mockResolvedValue(undefined);
      const professores = {
        getProfile: jest.fn().mockResolvedValue(prof),
        marcarUsoIaWor: marcar,
      } as unknown as ProfessorService;
      return { service: new WorIaService(gemini, professores), gemini, marcar };
    }

    it('503 quando a IA está indisponível (sem chave)', async () => {
      const { service } = make({ disponivel: false, usouHoje: false });
      await expect(service.gerarArsenal('u1', dto)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('403 quando o professor não é PhD', async () => {
      const { service, marcar } = make({
        disponivel: true,
        usouHoje: false,
        phd: false,
      });
      await expect(service.gerarArsenal('u1', dto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(marcar).not.toHaveBeenCalled();
    });

    it('429 quando já usou hoje', async () => {
      const { service, marcar } = make({ disponivel: true, usouHoje: true });
      await expect(service.gerarArsenal('u1', dto)).rejects.toMatchObject({
        response: { code: 'IA_RATE_LIMIT' },
      });
      await expect(service.gerarArsenal('u1', dto)).rejects.toBeInstanceOf(
        HttpException,
      );
      expect(marcar).not.toHaveBeenCalled();
    });

    it('não consome a cota quando a IA devolve algo inválido', async () => {
      const { service, marcar } = make({
        disponivel: true,
        usouHoje: false,
        texto: 'nada útil aqui',
      });
      await expect(service.gerarArsenal('u1', dto)).rejects.toMatchObject({
        response: { code: 'IA_SEM_RESULTADO' },
      });
      expect(marcar).not.toHaveBeenCalled();
    });

    it('gera o arsenal e marca o uso quando liberado', async () => {
      const { service, gemini, marcar } = make({
        disponivel: true,
        usouHoje: false,
      });
      const r = await service.gerarArsenal('u1', dto);
      expect(r.palavras).toEqual([
        { palavra: 'GUILHOTINA', dicas: ['a', 'b', 'c'] },
      ]);
      const prompt = (gemini.gerarTexto as jest.Mock).mock.calls[0][0] as string;
      expect(prompt).toContain('História');
      expect(prompt).toContain('termos da Revolução Francesa');
      expect(marcar).toHaveBeenCalledWith('u1');
    });
  });
});
