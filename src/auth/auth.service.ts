import { Injectable, UnauthorizedException } from '@nestjs/common';
import { DecodedIdToken } from 'firebase-admin/auth';
import { FirebaseService } from '../firebase/firebase.service';

@Injectable()
export class AuthService {
  constructor(private readonly firebase: FirebaseService) {}

  async verifyToken(token: string): Promise<DecodedIdToken> {
    try {
      return await this.firebase.auth.verifyIdToken(token);
    } catch {
      throw new UnauthorizedException('Token invalido ou expirado.');
    }
  }
}
