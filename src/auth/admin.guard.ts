import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { FirebaseService } from '../firebase/firebase.service';
import { RequestUser } from './auth.types';

/**
 * Protege o backoffice. **Fonte de verdade do admin: Firestore**
 * (`professores/{uid}.isAdmin === true`), lido a cada chamada de `/admin/*`
 * (rota de baixo volume). Assim, promover/revogar admin vale na hora — sem
 * redeploy (era o problema do `ADMIN_EMAILS`) e sem re-login (era o do claim).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly firebase: FirebaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request['user'] as RequestUser | undefined;
    if (!user?.uid) {
      throw new ForbiddenException('Acesso restrito a administradores.');
    }

    const snap = await this.firebase.firestore
      .collection('professores')
      .doc(user.uid)
      .get();

    if (snap.data()?.isAdmin !== true) {
      throw new ForbiddenException('Acesso restrito a administradores.');
    }
    return true;
  }
}
