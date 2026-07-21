import { IsInt, Max, Min } from 'class-validator';

/** Uma alocacao da turma num horario da grade da instituicao. */
export class GradeHorariaItemDto {
  @IsInt()
  @Min(0)
  @Max(6)
  diaSemana: number;

  @IsInt()
  @Min(1)
  @Max(40)
  periodo: number;
}
