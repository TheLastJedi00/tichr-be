import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PularFaseDto } from './dto/pular-fase.dto';

/**
 * O telão manda a fase que exibia no clique. Toda fase com cronômetro tem de
 * passar na validação — senão o pulo morre com 400 antes de chegar ao serviço.
 */
describe('PularFaseDto — fases aceitas', () => {
  const erros = (status: unknown) =>
    validateSync(plainToInstance(PularFaseDto, { status })).length;

  it.each([
    'DESLOCAMENTO',
    'QUESTAO_ATIVA',
    'RESULTADO_RODADA',
    'QUARENTENA_DEBATE',
    'QUARENTENA_VOTO',
    'RESGATE_VOTO',
  ])('aceita %p', (status) => {
    expect(erros(status)).toBe(0);
  });

  it('aceita o pulo sem fase informada', () => {
    expect(erros(undefined)).toBe(0);
  });

  it.each(['LOBBY', 'ENCERRADO', 'QUALQUER'])('recusa %p', (status) => {
    expect(erros(status)).toBeGreaterThan(0);
  });
});
