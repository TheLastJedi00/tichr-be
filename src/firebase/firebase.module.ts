import { Global, Module } from '@nestjs/common';
import { FirebaseService } from './firebase.service';
import { RtdbService } from './rtdb.service';

@Global()
@Module({
  providers: [FirebaseService, RtdbService],
  exports: [FirebaseService, RtdbService],
})
export class FirebaseModule {}
