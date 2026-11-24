// Opção das configurações: devolver ao terminal uma pergunta ou pedido de permissão quando nenhuma página do
// escritório que possa responder ficou aberta por UNWATCHED_MS. Ligada por padrão (comportamento de sempre); desligada,
// o pedido espera no escritório até ser respondido ou até o tempo máximo do hook. Gravada em <dataDir>, para valer
// depois de reiniciar o servidor (e no Docker, onde o dataDir é um volume).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tr } from '../../shared/i18n';
import { errMsg, log } from '../log';

export const DEFAULT_RETURN_WHEN_UNWATCHED = true;

export interface PermissionSettings {
  returnWhenUnwatched: boolean;
}

/** `file` null = só em memória (testes). */
export class PermissionSettingsStore {
  private returnWhenUnwatched = DEFAULT_RETURN_WHEN_UNWATCHED;

  constructor(
    private readonly file: string | null,
    private readonly onChange?: () => void,
  ) {}

  load(): void {
    this.returnWhenUnwatched = DEFAULT_RETURN_WHEN_UNWATCHED;
    if (!this.file) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const value = (raw as Record<string, unknown>).returnWhenUnwatched;
        if (typeof value === 'boolean') this.returnWhenUnwatched = value;
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') log.warn(tr('[permissões] configurações ilegíveis ({0}): mantendo o padrão.', [code ?? 'JSON']));
    }
  }

  get(): PermissionSettings {
    return { returnWhenUnwatched: this.returnWhenUnwatched };
  }

  set(returnWhenUnwatched: boolean): void {
    if (this.returnWhenUnwatched === returnWhenUnwatched) return;
    this.returnWhenUnwatched = returnWhenUnwatched;
    this.write();
    this.onChange?.();
  }

  private write(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ returnWhenUnwatched: this.returnWhenUnwatched }), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      log.warn(tr('[permissões] não deu para gravar as configurações: {0}', [errMsg(err)]));
    }
  }
}
