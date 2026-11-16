import { SETORES } from './isolateus.data';
import {
  CENA,
  alvoDentroDaCena,
  portasDe,
  posicaoEm,
  xDaPorta,
} from './isolateus-cena';

describe('Isolateus 034 — geometria da cena', () => {
  it('toda ligação da malha vira uma porta, e só uma por vizinho', () => {
    for (const s of SETORES) {
      const portas = portasDe(s.id);
      expect(portas.map((p) => p.para).sort()).toEqual([...s.vizinhos].sort());
    }
  });

  it('o lado segue o mapa: vizinho à direita no mapa = porta da direita', () => {
    expect(portasDe('seguranca')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ para: 'energia', lado: 'direita' }),
        expect.objectContaining({ para: 'comercio', lado: 'esquerda' }),
      ]),
    );
    expect(portasDe('abastecimento')).toEqual([
      expect.objectContaining({ para: 'comunicacao', lado: 'esquerda' }),
    ]);
  });

  it('a Comunicação tem a terceira porta no fundo, à direita do centro', () => {
    const portas = portasDe('comunicacao');
    const fundo = portas.find((p) => p.lado === 'fundo')!;
    expect(fundo.para).toBe('saude');
    expect(fundo.x).toBeGreaterThan(CENA.LARGURA / 2);
    expect(portas.find((p) => p.para === 'energia')!.lado).toBe('esquerda');
    expect(portas.find((p) => p.para === 'abastecimento')!.lado).toBe(
      'direita',
    );
  });

  it('xDaPorta devolve o x do destino (ou undefined sem estrada)', () => {
    expect(xDaPorta('seguranca', 'energia')).toBe(portasDe('seguranca')[0].x);
    expect(xDaPorta('seguranca', 'abastecimento')).toBeUndefined();
  });

  it('alvo fora da cena é recusado', () => {
    expect(alvoDentroDaCena(0)).toBe(true);
    expect(alvoDentroDaCena(CENA.LARGURA)).toBe(true);
    expect(alvoDentroDaCena(-1)).toBe(false);
    expect(alvoDentroDaCena(CENA.LARGURA + 1)).toBe(false);
    expect(alvoDentroDaCena(Number.NaN)).toBe(false);
  });

  it('posicaoEm anda em velocidade fixa até o alvo e para nele', () => {
    const t0 = 1_000;
    const passo = { x: 100, alvoX: 200, t: t0 };
    expect(posicaoEm(passo, t0)).toBe(100);
    expect(posicaoEm(passo, t0 + 1000)).toBeCloseTo(100 + CENA.VELOCIDADE);
    expect(posicaoEm(passo, t0 + 60_000)).toBe(200);
    // Para a esquerda também.
    expect(posicaoEm({ x: 100, alvoX: 0, t: t0 }, t0 + 60_000)).toBe(0);
    // Relógio atrasado não anda para trás.
    expect(posicaoEm(passo, t0 - 5_000)).toBe(100);
  });
});
