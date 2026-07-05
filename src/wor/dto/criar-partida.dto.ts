import { IsString, IsNotEmpty } from 'class-validator';

export class CriarPartidaDto {
  @IsString()
  @IsNotEmpty()
  turmaId: string;
}
