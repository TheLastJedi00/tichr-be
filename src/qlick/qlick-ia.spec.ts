import {
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ProfessorEntity } from '../professor/entities/professor.entity';
import { ConfigIaService } from '../ia-governanca/config-ia.service';
import {
  ContextoPrompt,
  PromptIaService,
} from '../ia-governanca/prompt-ia.service';
import { QlickIaService } from './qlick-ia.service';

const PERGUNTAS_JSON = JSON.stringify(
  Array.from({ length: 10 }, (_, i) => ({
    enunciado: `Pergunta ${i + 1}?`,
    alternativas: ['a', 'b', 'c', 'd'],
    corretaIndex: i % 4,
  })),
);

function montar(opts: {
  disponivel?: boolean;
  plano?: 'ESTAGIARIO' | 'PHD';
  usouHoje?: boolean;
  texto?: string;
}) {
  const gemini = {
    disponivel: () => opts.disponivel ?? true,
    gerarTexto: jest.fn().mockResolvedValue(opts.texto ?? PERGUNTAS_JSON),
  } as never;
  const hoje = new Date().toISOString().slice(0, 10);
  const prof = new ProfessorEntity({
    planoAtual: opts.plano ?? 'PHD',
    qlickIaUsos: opts.usouHoje ? { dia: hoje, n: 1 } : undefined,
  });
  const marcar = jest.fn().mockResolvedValue(undefined);
  const professores = {
    getProfile: jest.fn().mockResolvedValue(prof),
    registrarUsoIa: marcar,
  } as never;
  const prompts = {
    montar: jest.fn((_jogo: string, ctx: ContextoPrompt) =>
      Promise.resolve(JSON.stringify(ctx)),
    ),
  } as unknown as PromptIaService;
  const configIa = {
    limiteGeracoesDia: jest.fn().mockResolvedValue(1),
  } as unknown as ConfigIaService;
  return {
    service: new QlickIaService(gemini, professores, prompts, configIa),
    marcar,
  };
}

const dto = { instrucao: 'perguntas de revisão', disciplina: 'História', topico: 'Idade Média' };

describe('QlickIaService.gerarPerguntas', () => {
  it('sucesso: devolve 10 perguntas e consome a cota diária', async () => {
    const { service, marcar } = montar({});
    const { perguntas } = await service.gerarPerguntas('uid1', dto);
    expect(perguntas).toHaveLength(10);
    expect(perguntas[0].alternativas).toHaveLength(4);
    expect(marcar).toHaveBeenCalledWith('uid1', 'qlick', expect.any(String));
  });

  it('IA indisponível: 503 e não consome cota', async () => {
    const { service, marcar } = montar({ disponivel: false });
    await expect(service.gerarPerguntas('uid1', dto)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(marcar).not.toHaveBeenCalled();
  });

  it('plano não-PhD: 403 QLICK_LOCKED', async () => {
    const { service, marcar } = montar({ plano: 'ESTAGIARIO' });
    await expect(service.gerarPerguntas('uid1', dto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(marcar).not.toHaveBeenCalled();
  });

  it('rate limit: 429 quando já gerou hoje', async () => {
    const { service, marcar } = montar({ usouHoje: true });
    await expect(service.gerarPerguntas('uid1', dto)).rejects.toMatchObject({
      response: { code: 'IA_RATE_LIMIT' },
    });
    expect(marcar).not.toHaveBeenCalled();
  });

  it('IA sem perguntas válidas: 503 e não consome cota', async () => {
    const { service, marcar } = montar({ texto: 'desculpe, não consigo' });
    await expect(service.gerarPerguntas('uid1', dto)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(marcar).not.toHaveBeenCalled();
  });
});

describe('QlickIaService.extrairPerguntas', () => {
  it('parse válido mantém as perguntas', () => {
    const ps = QlickIaService.extrairPerguntas(PERGUNTAS_JSON);
    expect(ps).toHaveLength(10);
    expect(ps[1]).toEqual({
      enunciado: 'Pergunta 2?',
      alternativas: ['a', 'b', 'c', 'd'],
      corretaIndex: 1,
    });
  });

  it('corrige corretaIndex fora do intervalo para 0', () => {
    const ps = QlickIaService.extrairPerguntas(
      '[{"enunciado":"P?","alternativas":["a","b"],"corretaIndex":9}]',
    );
    expect(ps[0].corretaIndex).toBe(0);
  });

  it('descarta itens sem enunciado ou com menos de 2 alternativas', () => {
    const ps = QlickIaService.extrairPerguntas(
      '[{"enunciado":"","alternativas":["a","b"],"corretaIndex":0},{"enunciado":"ok","alternativas":["a"],"corretaIndex":0}]',
    );
    expect(ps).toHaveLength(0);
  });

  it('texto sem JSON retorna vazio', () => {
    expect(QlickIaService.extrairPerguntas('sem json aqui')).toEqual([]);
  });
});
