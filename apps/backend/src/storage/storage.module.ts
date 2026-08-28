import { Global, Module } from '@nestjs/common';
import { LocalDiskDriver } from './local-disk.driver';
import { StorageDriver } from './storage.driver';

/**
 * En desarrollo sólo existe `LocalDiskDriver`. Cuando entre el driver privado
 * compatible con S3, este módulo decide cuál inyectar según el entorno; el resto
 * de la aplicación sigue dependiendo únicamente de `StorageDriver`.
 */
@Global()
@Module({
  providers: [LocalDiskDriver, { provide: StorageDriver, useExisting: LocalDiskDriver }],
  exports: [StorageDriver, LocalDiskDriver],
})
export class StorageModule {}
