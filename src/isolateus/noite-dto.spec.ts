import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  DefinirCronometroIsolateusDto,
  IniciarPartidaIsolateusDto,
} from './dto/responder-isolateus.dto';

/** 036 #2: o tempo de movimentação só aceita os chips do lobby. */
describe('Isolateus 036 — segundosNoite nas DTOs do lobby', () => {
  const erros = (Dto: new () => object, corpo: object) =>
    validateSync(plainToInstance(Dto, corpo), {
      whitelist: true,
      forbidNonWhitelisted: true,
    }).length;

  it.each([10, 20, 30, 45, 60])('aceita %p', (s) => {
    expect(erros(IniciarPartidaIsolateusDto, { segundosNoite: s })).toBe(0);
    expect(
      erros(DefinirCronometroIsolateusDto, { segundos: 30, segundosNoite: s }),
    ).toBe(0);
  });

  it.each([0, 5, 15, 90, '20'])('recusa %p', (s) => {
    expect(
      erros(IniciarPartidaIsolateusDto, { segundosNoite: s }),
    ).toBeGreaterThan(0);
  });

  it('é opcional', () => {
    expect(erros(IniciarPartidaIsolateusDto, {})).toBe(0);
  });
});
