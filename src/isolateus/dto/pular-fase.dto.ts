import { IsIn, IsOptional } from 'class-validator';
import type { StatusIsolateus } from '../entities/isolateus-match.entity';

const FASES_CRONOMETRADAS: StatusIsolateus[] = [
  'DESLOCAMENTO',
  'QUESTAO_ATIVA',
  'RESULTADO_RODADA',
  'QUARENTENA_DEBATE',
  'QUARENTENA_VOTO',
];

/**
 * O pulo do professor. `status` é a fase que o telão exibia no clique: se a
 * partida já tiver virado, o pulo volta sem efeito (não derruba duas fases).
 */
export class PularFaseDto {
  @IsOptional()
  @IsIn(FASES_CRONOMETRADAS)
  status?: StatusIsolateus;
}
