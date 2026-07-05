import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { FirebaseService } from '../firebase/firebase.service';

/** ExecutionContext falso com um request.user fixo. */
function ctx(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

/** Firebase falso cujo doc de professor devolve `data`. */
function fakeFirebase(data: Record<string, unknown> | undefined): FirebaseService {
  return {
    firestore: {
      collection: () => ({ doc: () => ({ get: async () => ({ data: () => data }) }) }),
    },
  } as unknown as FirebaseService;
}

describe('AdminGuard (isAdmin no Firestore)', () => {
  it('autoriza quando professores/{uid}.isAdmin === true', async () => {
    const guard = new AdminGuard(fakeFirebase({ isAdmin: true }));
    await expect(
      guard.canActivate(ctx({ uid: 'u1', role: 'PROFESSOR' })),
    ).resolves.toBe(true);
  });

  it('bloqueia (403) quando isAdmin é falso/ausente', async () => {
    const guard = new AdminGuard(fakeFirebase({ isAdmin: false }));
    await expect(
      guard.canActivate(ctx({ uid: 'u1', role: 'PROFESSOR' })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const semCampo = new AdminGuard(fakeFirebase({}));
    await expect(
      semCampo.canActivate(ctx({ uid: 'u1', role: 'PROFESSOR' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('bloqueia (403) sem principal autenticado', async () => {
    const guard = new AdminGuard(fakeFirebase({ isAdmin: true }));
    await expect(guard.canActivate(ctx(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
