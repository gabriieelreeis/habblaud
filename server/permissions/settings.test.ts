// Configurações de "responder pelo escritório" salvas no servidor: padrão ligado, leitura de arquivo ausente ou
// inválido, persistência entre inicializações e aviso para marcar o snapshot como sujo.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import { DEFAULT_RETURN_WHEN_UNWATCHED, PermissionSettingsStore } from './settings';

setQuiet(true);

describe('PermissionSettingsStore', () => {
  it('começa ligado, avisa quem mudou e grava para a próxima inicialização', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'permissions-settings.json');
      const onChange = vi.fn();
      const store = new PermissionSettingsStore(file, onChange);
      store.load();
      expect(store.get()).toEqual({ returnWhenUnwatched: DEFAULT_RETURN_WHEN_UNWATCHED });
      expect(onChange).not.toHaveBeenCalled();

      store.set(false);
      expect(store.get()).toEqual({ returnWhenUnwatched: false });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ returnWhenUnwatched: false });

      store.set(true);
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ returnWhenUnwatched: true });

      const again = new PermissionSettingsStore(file);
      again.load();
      expect(again.get()).toEqual({ returnWhenUnwatched: true });
      again.set(true);
      expect(onChange).toHaveBeenCalledTimes(2);
    } finally {
      tmp.cleanup();
    }
  });

  it('sem arquivo, com JSON quebrado ou com tipo errado: mantém o padrão', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'permissions-settings.json');
      const missing = new PermissionSettingsStore(file);
      missing.load();
      expect(missing.get().returnWhenUnwatched).toBe(true);

      for (const raw of ['{quebrado', '[]', '{"returnWhenUnwatched":"nao"}', 'null']) {
        writeFileSync(file, raw);
        const store = new PermissionSettingsStore(file);
        store.load();
        expect(store.get().returnWhenUnwatched, raw).toBe(true);
      }
    } finally {
      tmp.cleanup();
    }
  });

  it('só em memória (testes): muda sem gravar nada', () => {
    const onChange = vi.fn();
    const store = new PermissionSettingsStore(null, onChange);
    store.load();
    store.set(false);
    expect(store.get().returnWhenUnwatched).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
