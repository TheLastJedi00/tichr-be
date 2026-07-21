import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateFeriasDto {
  @IsOptional()
  @IsString()
  turmaId?: string;

  /** Escopo por instituicao: as ferias valem so para as turmas daquela escola. */
  @IsOptional()
  @IsString()
  instituicaoId?: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dataInicio deve estar no formato YYYY-MM-DD',
  })
  dataInicio: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dataFim deve estar no formato YYYY-MM-DD',
  })
  dataFim: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  descricao?: string;
}
