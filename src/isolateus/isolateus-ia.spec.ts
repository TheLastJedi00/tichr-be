import {
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ProfessorEntity } from '../professor/entities/professor.entity';
import { ProfessorService } from '../professor/professor.service';
import { GeminiService } from '../wor/gemini.service';
import { IsolateusIaService } from './isolateus-ia.service';

describe('IA das questões do Isolateus', () => {
  describe('IsolateusIaService.extrairQuestoes', () => {
    it('parseia o array JSON e limita a 10 questões', () => {
      const arr = Array.from({ length: 12 }, (_, i) => ({
        enunciado: `Q${i}`,
        alternativas: ['a', 'b', 'c', 'd'],
        corretaIndex: 1,
      }));
      const r = IsolateusIaService.extrairQuestoes(JSON.stringify(arr));
      expect(r).toHaveLength(10);
      expect(r[0]).toEqual({
        enunciado: 'Q0',
        alternativas: ['a', 'b', 'c', 'd'],
        corretaIndex: 1,
      });
    });

    it('ignora cercas markdown e itens sem enunciado ou com menos de 2 alternativas', () => {
      const texto =
        '```json\n[{"enunciado":"","alternativas":["a","b"],"corretaIndex":0},' +
        '{"enunciado":"Sozinha","alternativas":["a"],"corretaIndex":0},' +
        '{"enunciado":"Válida","alternativas":["a","b"],"corretaIndex":1}]\n```';
      expect(IsolateusIaService.extrairQuestoes(texto)).toEqual([
        { enunciado: 'Válida', alternativas: ['a', 'b'], corretaIndex: 1 },
      ]);
    });

    it('corrige o corretaIndex fora do intervalo para 0', () => {
      const texto = JSON.stringify([
        { enunciado: 'Q', alternativas: ['a', 'b'], corretaIndex: 7 },
      ]);
      expect(IsolateusIaService.extrairQuestoes(texto)[0].corretaIndex).toBe(0);
    });

    it('devolve vazio quando não há JSON parseável', () => {
      expect(IsolateusIaService.extrairQuestoes('não consegui')).toEqual([]);
    });
  });

  describe('IsolateusIaService (plano e rate limit)', () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const dto = { instrucao: 'ciclo da água', disciplina: 'Ciências' };
    const resposta = JSON.stringify([
      { enunciado: 'O que é evaporação?', alternativas: ['a', 'b', 'c', 'd'], corretaIndex: 2 },
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
        isolateusIaUltimoUso: opts.usouHoje ? `${hoje}T10:00:00.000Z` : undefined,
      });
      const marcar = jest.fn().mockResolvedValue(undefined);
      const professores = {
        getProfile: jest.fn().mockResolvedValue(prof),
        marcarUsoIaIsolateus: marcar,
      } as unknown as ProfessorService;
      return { service: new IsolateusIaService(gemini, professores), gemini, marcar };
    }

    it('503 quando a IA está indisponível (sem chave)', async () => {
      const { service } = make({ disponivel: false, usouHoje: false });
      await expect(service.gerarQuestoes('u1', dto)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('403 quando o professor não é PhD', async () => {
      const { service, marcar } = make({
        disponivel: true,
        usouHoje: false,
        phd: false,
      });
      await expect(service.gerarQuestoes('u1', dto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(marcar).not.toHaveBeenCalled();
    });

    it('429 quando já usou hoje (contador próprio do Isolateus)', async () => {
      const { service, marcar } = make({ disponivel: true, usouHoje: true });
      await expect(service.gerarQuestoes('u1', dto)).rejects.toMatchObject({
        response: { code: 'IA_RATE_LIMIT' },
      });
      await expect(service.gerarQuestoes('u1', dto)).rejects.toBeInstanceOf(
        HttpException,
      );
      expect(marcar).not.toHaveBeenCalled();
    });

    it('a cota do Qlick/Wor no mesmo dia não bloqueia o Isolateus', async () => {
      const gemini = {
        disponivel: () => true,
        gerarTexto: jest.fn().mockResolvedValue(resposta),
      } as unknown as GeminiService;
      const prof = new ProfessorEntity({
        uid: 'u1',
        planoAtual: 'PHD',
        qlickIaUltimoUso: `${hoje}T10:00:00.000Z`,
        worIaUltimoUso: `${hoje}T10:00:00.000Z`,
      });
      const marcar = jest.fn().mockResolvedValue(undefined);
      const professores = {
        getProfile: jest.fn().mockResolvedValue(prof),
        marcarUsoIaIsolateus: marcar,
      } as unknown as ProfessorService;
      const service = new IsolateusIaService(gemini, professores);

      const r = await service.gerarQuestoes('u1', dto);
      expect(r.questoes).toHaveLength(1);
      expect(marcar).toHaveBeenCalledWith('u1');
    });

    it('não consome a cota quando a IA devolve algo inválido', async () => {
      const { service, marcar } = make({
        disponivel: true,
        usouHoje: false,
        texto: 'nada útil aqui',
      });
      await expect(service.gerarQuestoes('u1', dto)).rejects.toMatchObject({
        response: { code: 'IA_SEM_RESULTADO' },
      });
      expect(marcar).not.toHaveBeenCalled();
    });

    it('gera as questões e marca o uso quando liberado', async () => {
      const { service, gemini, marcar } = make({
        disponivel: true,
        usouHoje: false,
      });
      const r = await service.gerarQuestoes('u1', dto);
      expect(r.questoes[0].corretaIndex).toBe(2);
      const prompt = (gemini.gerarTexto as jest.Mock).mock.calls[0][0] as string;
      expect(prompt).toContain('Ciências');
      expect(prompt).toContain('ciclo da água');
      expect(marcar).toHaveBeenCalledWith('u1');
    });
  });
});
