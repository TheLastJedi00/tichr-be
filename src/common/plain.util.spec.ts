import { paraPlano } from './plain.util';

class Fake {
  constructor(
    public a: string,
    public b: number,
  ) {}
}

describe('paraPlano', () => {
  it('remove o prototipo de classe (Firestore-safe)', () => {
    const arr = [new Fake('x', 1), new Fake('y', 2)];
    const plano = paraPlano(arr);
    expect(plano).toEqual([
      { a: 'x', b: 1 },
      { a: 'y', b: 2 },
    ]);
    // objetos planos (prototipo = Object), nao mais instancias de Fake
    expect(plano[0] instanceof Fake).toBe(false);
    expect(Object.getPrototypeOf(plano[0])).toBe(Object.prototype);
  });

  it('preserva undefined/null sem quebrar', () => {
    expect(paraPlano(undefined)).toBeUndefined();
    expect(paraPlano(null)).toBeNull();
  });

  it('planifica objetos aninhados (turno com intervalos)', () => {
    const turno = new Fake('MATUTINO', 0) as unknown as Record<string, unknown>;
    turno.intervalos = [new Fake('09:30', 20)];
    const plano = paraPlano(turno) as { intervalos: unknown[] };
    expect(plano.intervalos[0] instanceof Fake).toBe(false);
  });
});
