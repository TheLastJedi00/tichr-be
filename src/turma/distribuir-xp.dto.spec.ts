import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DistribuirXpDto } from './dto/distribuir-xp.dto';

/** Spec 025 §8: o professor adiciona ou remove até 99999 de XP por vez. */
describe('DistribuirXpDto — limite por operação', () => {
  const erros = (pontos: unknown) =>
    validateSync(plainToInstance(DistribuirXpDto, { pontos })).length;

  it.each([99999, -99999, 1, -1, 1000])('aceita %p', (pontos) => {
    expect(erros(pontos)).toBe(0);
  });

  it.each([100000, -100000, 1.5])('recusa %p', (pontos) => {
    expect(erros(pontos)).toBeGreaterThan(0);
  });
});
