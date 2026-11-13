import { BadRequestException, ConflictException } from '@nestjs/common';
import { dividirIgual } from '../common/dividir';
import { DenunciaEntity } from './entities/denuncia.entity';
import { DenunciaGrupoEntity } from './entities/denuncia-grupo.entity';

/**
 * Spec 033 — grupo de denúncias contra o mesmo aluno. O que importa travar:
 * - só pendentes, da mesma turma, contra o mesmo denunciado, cada uma em um grupo;
 * - o grupo que fica com 1 denúncia se desfaz;
 * - a divisão nunca cria nem perde ponto, e a sobra vai para os mais antigos.
 */

function den(id: string, extra: Partial<DenunciaEntity> = {}): DenunciaEntity {
  return new DenunciaEntity({
    id,
    turmaId: 't1',
    professorId: 'p1',
    autorAlunoId: `autor-${id}`,
    denunciadoAlunoId: 'alvo',
    topicoId: 'tp1',
    topicoTitulo: 'Celular',
    status: 'PENDENTE',
    criadaEm: `2026-11-12T10:00:0${id.slice(-1)}.000Z`,
    ...extra,
  });
}

const codigo = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (e) {
    return (e as BadRequestException).getResponse();
  }
  throw new Error('não lançou');
};

describe('dividirIgual', () => {
  it('divide igual e dá a sobra, 1 por vez, aos primeiros', () => {
    expect(dividirIgual(1000, 3)).toEqual([334, 333, 333]);
    expect(dividirIgual(1001, 3)).toEqual([334, 334, 333]);
    expect(dividirIgual(900, 3)).toEqual([300, 300, 300]);
  });

  it('total menor que o número de autores e total zero', () => {
    expect(dividirIgual(2, 3)).toEqual([1, 1, 0]);
    expect(dividirIgual(0, 4)).toEqual([0, 0, 0, 0]);
  });

  it('um autor leva tudo; a soma sempre bate', () => {
    expect(dividirIgual(777, 1)).toEqual([777]);
    for (const [t, n] of [
      [10000, 7],
      [1, 5],
      [9999, 2],
    ]) {
      expect(dividirIgual(t, n).reduce((a, b) => a + b, 0)).toBe(t);
    }
  });
});

describe('DenunciaGrupoEntity', () => {
  it('cria com 2+ pendentes contra o mesmo aluno, em ordem cronológica', () => {
    const g = DenunciaGrupoEntity.criar([den('d2'), den('d1')]);
    expect(g).toMatchObject({
      turmaId: 't1',
      professorId: 'p1',
      denunciadoAlunoId: 'alvo',
      topicoId: 'tp1',
      denunciaIds: ['d1', 'd2'],
      status: 'PENDENTE',
    });
  });

  it('recusa grupo com menos de 2, denunciado diferente, resolvida e já agrupada', () => {
    expect(codigo(() => DenunciaGrupoEntity.criar([den('d1')]))).toMatchObject({
      code: 'GRUPO_MINIMO',
    });
    expect(
      codigo(() =>
        DenunciaGrupoEntity.criar([
          den('d1'),
          den('d2', { denunciadoAlunoId: 'outro' }),
        ]),
      ),
    ).toMatchObject({ code: 'DENUNCIADO_DIFERENTE' });
    expect(
      codigo(() =>
        DenunciaGrupoEntity.criar([
          den('d1'),
          den('d2', { status: 'VALIDADA' }),
        ]),
      ),
    ).toMatchObject({ code: 'DENUNCIA_RESOLVIDA' });
    expect(
      codigo(() =>
        DenunciaGrupoEntity.criar([den('d1'), den('d2', { grupoId: 'gX' })]),
      ),
    ).toMatchObject({ code: 'DENUNCIA_EM_GRUPO' });
    expect(
      codigo(() => DenunciaGrupoEntity.criar([den('d1'), den('d1')])),
    ).toMatchObject({ code: 'GRUPO_MINIMO' });
  });

  it('associar: mesmo denunciado; avisa quando o motivo é diferente', () => {
    const g = DenunciaGrupoEntity.criar([den('d1'), den('d2')]);
    expect(g.associar(den('d3', { topicoId: 'tp2' }))).toEqual({
      motivoDiferente: true,
    });
    expect(g.associar(den('d4'))).toEqual({ motivoDiferente: false });
    expect(g.denunciaIds).toEqual(['d1', 'd2', 'd3', 'd4']);
    expect(
      codigo(() => g.associar(den('d5', { denunciadoAlunoId: 'outro' }))),
    ).toMatchObject({ code: 'DENUNCIADO_DIFERENTE' });
    expect(codigo(() => g.associar(den('d1')))).toMatchObject({
      code: 'DENUNCIA_EM_GRUPO',
    });
  });

  it('denúncia só com texto livre conta como motivo diferente (só tópico igual é mesmo motivo)', () => {
    const g = DenunciaGrupoEntity.criar([den('d1'), den('d2')]);
    expect(g.associar(den('d3', { topicoId: undefined }))).toEqual({
      motivoDiferente: true,
    });
  });

  it('desassociar tira do grupo; com 1 restante, o grupo se desfaz', () => {
    const g = DenunciaGrupoEntity.criar([den('d1'), den('d2'), den('d3')]);
    expect(g.desassociar('d2')).toEqual({ desfeito: false });
    expect(g.denunciaIds).toEqual(['d1', 'd3']);
    expect(g.desassociar('d3')).toEqual({ desfeito: true });
    expect(codigo(() => g.desassociar('zz'))).toMatchObject({
      code: 'DENUNCIA_FORA_DO_GRUPO',
    });
  });

  it('grupo resolvido não muda: 409', () => {
    const g = DenunciaGrupoEntity.criar([den('d1'), den('d2')]);
    g.status = 'VALIDADO';
    expect(() => g.associar(den('d3'))).toThrow(ConflictException);
    expect(() => g.desassociar('d1')).toThrow(ConflictException);
    expect(() => g.assertPendente()).toThrow(ConflictException);
  });

  it('dividir: partes por autor na ordem dada (mais antigo primeiro)', () => {
    expect(DenunciaGrupoEntity.dividir(1000, ['a', 'b', 'c'])).toEqual([
      { alunoId: 'a', pontos: 334 },
      { alunoId: 'b', pontos: 333 },
      { alunoId: 'c', pontos: 333 },
    ]);
  });
});
