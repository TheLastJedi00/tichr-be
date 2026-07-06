import { IsOptional, IsString } from 'class-validator';

export class CriarPartidaDto {
  /**
   * Turma da partida. Opcional: como no Qlick, se a batalha tiver uma única
   * turma atribuída, ela é usada automaticamente; com várias, o professor
   * escolhe qual rodar.
   */
  @IsOptional()
  @IsString()
  turmaId?: string;
}
