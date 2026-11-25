import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AtividadeEntity } from './entities/atividade.entity';
import {
  ArquivoEntrega,
  EntregaEntity,
  estadoDaEntrega,
} from './entities/entrega.entity';
import { TRABALHO } from './trabalho.constants';

/**
 * Spec 038 — envio de trabalhos. Trava as regras puras: prazo com data e hora
 * (#2, #11), exclusão só sem entregas (#5), entrega com texto e/ou arquivos
 * (#7–#9), edição até o prazo ou a avaliação (#10) e a nota que vira XP
 * (#14–#17).
 */

const AGORA = new Date('2026-11-25T14:00:00.000Z');
const PRAZO = '2026-12-05T23:59:00.000Z';

function codigo(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    const r = (e as { getResponse?: () => unknown }).getResponse?.();
    return (r as { code?: string })?.code;
  }
  return undefined;
}

function atividade(
  over: Partial<Parameters<typeof AtividadeEntity.criar>[0]> = {},
) {
  return AtividadeEntity.criar(
    {
      turmaId: 't1',
      professorId: 'p1',
      titulo: '  Site pessoal  ',
      descricao: 'Monte uma página',
      prazo: PRAZO,
      ...over,
    },
    AGORA,
  );
}

function arquivo(id = 'f1'): ArquivoEntrega {
  return {
    id,
    path: `trabalhos/t1/at1/a1/${id}`,
    nome: `${id}.pdf`,
    extensao: 'pdf',
    tamanho: 1000,
    enviadoEm: AGORA.toISOString(),
  };
}

function entrega(): EntregaEntity {
  return EntregaEntity.nova(
    { atividadeId: 'at1', turmaId: 't1', alunoId: 'a1' },
    AGORA,
  );
}

describe('AtividadeEntity', () => {
  it('cria com título limpo, prazo normalizado e valor padrão 100', () => {
    const a = atividade({ prazo: '2026-12-05T20:59:00-03:00' });
    expect(a.titulo).toBe('Site pessoal');
    expect(a.prazo).toBe(PRAZO);
    expect(a.valorPontos).toBe(TRABALHO.VALOR_PADRAO);
    expect(a.totalEntregas).toBe(0);
    expect(a.criadaEm).toBe(AGORA.toISOString());
  });

  it('título obrigatório e até 120; descrição até 2.000', () => {
    expect(codigo(() => atividade({ titulo: ' ' }))).toBe('TITULO_INVALIDO');
    expect(
      codigo(() => atividade({ titulo: 'x'.repeat(TRABALHO.TITULO_MAX + 1) })),
    ).toBe('TITULO_INVALIDO');
    expect(
      codigo(() =>
        atividade({ descricao: 'x'.repeat(TRABALHO.DESCRICAO_MAX + 1) }),
      ),
    ).toBe('DESCRICAO_GRANDE');
  });

  it('prazo é obrigatório e precisa de data E hora', () => {
    expect(codigo(() => atividade({ prazo: undefined }))).toBe(
      'PRAZO_OBRIGATORIO',
    );
    expect(codigo(() => atividade({ prazo: '2026-12-05' }))).toBe(
      'PRAZO_INVALIDO',
    );
    expect(codigo(() => atividade({ prazo: 'amanhã' }))).toBe('PRAZO_INVALIDO');
  });

  it('não cria com prazo no passado', () => {
    expect(codigo(() => atividade({ prazo: '2026-11-25T13:59:00Z' }))).toBe(
      'PRAZO_NO_PASSADO',
    );
  });

  it('valor em pontos de 0 a 1.000, inteiro', () => {
    expect(atividade({ valorPontos: 0 }).valorPontos).toBe(0);
    expect(atividade({ valorPontos: 1000 }).valorPontos).toBe(1000);
    for (const v of [-1, 1001, 2.5]) {
      expect(codigo(() => atividade({ valorPontos: v }))).toBe(
        'VALOR_INVALIDO',
      );
    }
  });

  it('fica aberta até o minuto do prazo e fecha logo depois', () => {
    const a = atividade();
    expect(a.aberta(new Date(PRAZO))).toBe(true);
    expect(a.aberta(new Date(Date.parse(PRAZO) + 1000))).toBe(false);
  });

  it('editar troca campos; prazo editado pode encerrar antes (no passado)', () => {
    const a = atividade();
    a.editar({ titulo: 'Novo', prazo: '2026-11-25T13:00:00Z' }, AGORA);
    expect(a.titulo).toBe('Novo');
    expect(a.aberta(AGORA)).toBe(false);
    expect(codigo(() => a.editar({ prazo: '2026-12-01' }, AGORA))).toBe(
      'PRAZO_INVALIDO',
    );
    expect(codigo(() => a.editar({ titulo: '' }, AGORA))).toBe(
      'TITULO_INVALIDO',
    );
  });

  it('contadores sobem e descem com a entrega', () => {
    const a = atividade();
    const vazia = { entregue: false, avaliada: false };
    const feita = { entregue: true, avaliada: false };
    const nota = { entregue: true, avaliada: true };
    a.contarEntrega(vazia, feita);
    expect([a.totalEntregas, a.aguardandoAvaliacao]).toEqual([1, 1]);
    a.contarEntrega(feita, feita);
    expect([a.totalEntregas, a.aguardandoAvaliacao]).toEqual([1, 1]);
    a.contarEntrega(feita, nota);
    expect([a.totalEntregas, a.aguardandoAvaliacao]).toEqual([1, 0]);
    a.contarEntrega(nota, nota);
    expect([a.totalEntregas, a.aguardandoAvaliacao]).toEqual([1, 0]);
    a.contarEntrega(feita, vazia);
    a.contarEntrega(feita, vazia);
    expect([a.totalEntregas, a.aguardandoAvaliacao]).toEqual([0, 0]);
  });

  it('só exclui sem entregas', () => {
    const a = atividade();
    expect(() => a.garantirExcluivel()).not.toThrow();
    a.totalEntregas = 1;
    expect(() => a.garantirExcluivel()).toThrow(ConflictException);
    expect(codigo(() => a.garantirExcluivel())).toBe('ATIVIDADE_COM_ENTREGAS');
  });
});

describe('EntregaEntity', () => {
  it('id determinístico por atividade e aluno', () => {
    expect(EntregaEntity.idDe('at1', 'a1')).toBe('at1_a1');
    expect(entrega().id).toBe('at1_a1');
  });

  it('conta como entregue com texto ou arquivo', () => {
    const e = entrega();
    expect(e.entregue).toBe(false);
    e.definirTexto('   ', AGORA);
    expect(e.entregue).toBe(false);
    e.definirTexto('Meu texto', AGORA);
    expect(e.entregue).toBe(true);
    e.definirTexto('', AGORA);
    e.adicionarArquivo(arquivo(), AGORA);
    expect(e.entregue).toBe(true);
  });

  it('texto até 10.000 caracteres', () => {
    const e = entrega();
    e.definirTexto('x'.repeat(TRABALHO.TEXTO_MAX), AGORA);
    expect(e.texto?.length).toBe(TRABALHO.TEXTO_MAX);
    expect(
      codigo(() => e.definirTexto('x'.repeat(TRABALHO.TEXTO_MAX + 1), AGORA)),
    ).toBe('TEXTO_GRANDE');
  });

  it('até 5 arquivos', () => {
    const e = entrega();
    for (let i = 0; i < TRABALHO.MAX_ARQUIVOS; i++) {
      e.adicionarArquivo(arquivo(`f${i}`), AGORA);
    }
    expect(() => e.adicionarArquivo(arquivo('f9'), AGORA)).toThrow(
      ConflictException,
    );
    expect(codigo(() => e.adicionarArquivo(arquivo('f9'), AGORA))).toBe(
      'LIMITE_ARQUIVOS',
    );
  });

  it('remove arquivo e devolve o removido; inexistente é 404', () => {
    const e = entrega();
    e.adicionarArquivo(arquivo('f1'), AGORA);
    expect(e.removerArquivo('f1', AGORA).path).toBe('trabalhos/t1/at1/a1/f1');
    expect(e.arquivos).toHaveLength(0);
    expect(e.entregue).toBe(false);
    expect(codigo(() => e.removerArquivo('f1', AGORA))).toBe(
      'ARQUIVO_NAO_ENCONTRADO',
    );
  });

  it('não edita fora do prazo nem depois de avaliada', () => {
    const a = atividade();
    const e = entrega();
    expect(() => e.garantirEditavel(a, AGORA)).not.toThrow();
    const depois = new Date(Date.parse(PRAZO) + 60_000);
    expect(() => e.garantirEditavel(a, depois)).toThrow(ForbiddenException);
    expect(codigo(() => e.garantirEditavel(a, depois))).toBe('PRAZO_ENCERRADO');

    e.definirTexto('ok', AGORA);
    e.avaliar({ nota: 7 }, { valorPontos: 100, pontuacaoAtiva: true }, AGORA);
    expect(codigo(() => e.garantirEditavel(a, AGORA))).toBe('ENTREGA_AVALIADA');
  });

  describe('avaliar', () => {
    function entregue(): EntregaEntity {
      const e = entrega();
      e.definirTexto('feito', AGORA);
      return e;
    }
    const cfg = { valorPontos: 100, pontuacaoAtiva: true };

    it('nota 8 numa atividade de 100 → +80', () => {
      const e = entregue();
      expect(e.avaliar({ nota: 8, comentario: ' Bom ' }, cfg, AGORA)).toBe(80);
      expect(e.avaliacao?.nota).toBe(8);
      expect(e.avaliacao?.comentario).toBe('Bom');
      expect(e.avaliacao?.avaliadaEm).toBe(AGORA.toISOString());
    });

    it('arredonda o XP (nota 7,5 de 33 → 25)', () => {
      expect(
        entregue().avaliar({ nota: 7.5 }, { ...cfg, valorPontos: 33 }, AGORA),
      ).toBe(25);
    });

    it('reavaliar devolve só a diferença do que já foi creditado', () => {
      const e = entregue();
      e.registrarCredito(e.avaliar({ nota: 8 }, cfg, AGORA));
      expect(e.avaliacao?.xpCreditado).toBe(80);
      const delta = e.avaliar({ nota: 6 }, cfg, AGORA);
      expect(delta).toBe(-20);
      e.registrarCredito(delta);
      expect(e.avaliacao?.xpCreditado).toBe(60);
    });

    it('sem XP quando a pontuação está desativada ou valor 0', () => {
      expect(
        entregue().avaliar(
          { nota: 10 },
          { ...cfg, pontuacaoAtiva: false },
          AGORA,
        ),
      ).toBe(0);
      expect(
        entregue().avaliar({ nota: 10 }, { ...cfg, valorPontos: 0 }, AGORA),
      ).toBe(0);
    });

    it('pontuação desligada depois não tira o que já entrou', () => {
      const e = entregue();
      e.registrarCredito(e.avaliar({ nota: 8 }, cfg, AGORA));
      expect(
        e.avaliar({ nota: 5 }, { ...cfg, pontuacaoAtiva: false }, AGORA),
      ).toBe(0);
      expect(e.avaliacao?.nota).toBe(5);
      expect(e.avaliacao?.xpCreditado).toBe(80);
    });

    it('nota de 0 a 10 com uma casa; comentário até 2.000', () => {
      for (const nota of [-1, 10.1, 7.25, NaN]) {
        expect(codigo(() => entregue().avaliar({ nota }, cfg, AGORA))).toBe(
          'NOTA_INVALIDA',
        );
      }
      expect(() => entregue().avaliar({ nota: 0 }, cfg, AGORA)).not.toThrow();
      // 1.1 * 10 = 11.000000000000002 em ponto flutuante
      expect(entregue().avaliar({ nota: 1.1 }, cfg, AGORA)).toBe(11);
      expect(
        codigo(() =>
          entregue().avaliar(
            { nota: 5, comentario: 'x'.repeat(TRABALHO.COMENTARIO_MAX + 1) },
            cfg,
            AGORA,
          ),
        ),
      ).toBe('COMENTARIO_GRANDE');
    });

    it('não avalia entrega vazia', () => {
      expect(() => entrega().avaliar({ nota: 5 }, cfg, AGORA)).toThrow(
        BadRequestException,
      );
      expect(codigo(() => entrega().avaliar({ nota: 5 }, cfg, AGORA))).toBe(
        'ENTREGA_VAZIA',
      );
    });
  });
});

describe('estadoDaEntrega', () => {
  const a = atividade();
  const depois = new Date(Date.parse(PRAZO) + 60_000);

  it('PENDENTE no prazo sem entrega; PERDIDA depois', () => {
    expect(estadoDaEntrega(a, undefined, AGORA)).toBe('PENDENTE');
    expect(estadoDaEntrega(a, entrega(), AGORA)).toBe('PENDENTE');
    expect(estadoDaEntrega(a, undefined, depois)).toBe('PERDIDA');
  });

  it('ENTREGUE mesmo depois do prazo; AVALIADA quando tem nota', () => {
    const e = entrega();
    e.definirTexto('ok', AGORA);
    expect(estadoDaEntrega(a, e, depois)).toBe('ENTREGUE');
    e.avaliar({ nota: 9 }, { valorPontos: 100, pontuacaoAtiva: true }, AGORA);
    expect(estadoDaEntrega(a, e, depois)).toBe('AVALIADA');
  });
});
