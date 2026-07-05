import { IsBoolean } from 'class-validator';

/** Concede (true) ou revoga (false) o acesso de administrador. */
export class DefinirAdminDto {
  @IsBoolean()
  conceder: boolean;
}
