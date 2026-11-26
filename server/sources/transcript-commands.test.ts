import { describe, expect, it } from 'vitest';
import { L } from '../test/fixtures';
import { commandOutputOf, createTranscriptState, mergePrefix, parseLine } from './transcript';

const T0 = Date.parse('2026-11-26T03:00:00Z');
const stdout = (text: string) => `<local-command-stdout>${text}</local-command-stdout>`;

describe('saída do /effort e do /model na conversa', () => {
  it('lê o nível das saídas do /effort (Claude Code 2.1.332)', () => {
    expect(commandOutputOf(stdout('Set effort level to xhigh (saved as your default for new sessions): Deeper reasoning than high, just below maximum (on supported models)'))).toEqual({ effort: 'xhigh' });
    expect(commandOutputOf(stdout('Set effort level to high (this session only): Balanced'))).toEqual({ effort: 'high' });
    expect(commandOutputOf(stdout("Effort 'max' exceeds the cap for claude-haiku-5-5 set by your settings or organization; set to 'high' instead (this session only): x"))).toEqual({ effort: 'high' });
    expect(commandOutputOf(stdout('Current effort level: medium (Balanced)'))).toEqual({ effort: 'medium' });
    expect(commandOutputOf(stdout('Effort level set to auto'))).toEqual({ effort: 'auto' });
    expect(commandOutputOf(stdout('Effort level: auto (currently high)'))).toEqual({ effort: 'auto' });
  });

  it('ignora o /effort que não aplicou nada', () => {
    expect(commandOutputOf(stdout("Couldn't set effort level: settings.json is not valid JSON"))).toBeUndefined();
    expect(commandOutputOf(stdout('Not applied: CLAUDE_CODE_EFFORT_LEVEL=low overrides effort this session, and high is session-only (nothing saved)'))).toBeUndefined();
    expect(commandOutputOf('<local-command-stderr>Set effort level to high</local-command-stderr>')).toBeUndefined();
  });

  it('lê o modelo das saídas do /model, sem as cores do terminal', () => {
    expect(commandOutputOf(stdout('Set model to \u001b[1mSonnet 5.5\u001b[22m and saved as your default for new sessions'))).toEqual({ model: 'Sonnet 5.5' });
    expect(commandOutputOf(stdout('Set model to `haiku` for this session only'))).toEqual({ model: 'haiku' });
    expect(commandOutputOf(stdout('Set model to Opus 5.5 with high effort'))).toEqual({ model: 'Opus 5.5' });
    expect(commandOutputOf(stdout('Kept model as Opus 5.5 · fast mode stays on'))).toEqual({ model: 'Opus 5.5' });
    expect(commandOutputOf(stdout('Login successful'))).toBeUndefined();
  });

  it('guarda o último /effort e /model com a hora da linha (também os do plugin)', () => {
    const s = createTranscriptState();
    const r = [
      parseLine(s, L.prompt('<command-name>/effort</command-name>\n<command-message>effort</command-message>\n<command-args>low</command-args>', { at: T0 }), { idPrefix: 'a:1', now: T0 }),
      parseLine(s, L.prompt(stdout('Set effort level to low (saved as your default for new sessions): Quick'), { at: T0 + 10 }), { idPrefix: 'a:1', now: T0 }),
      parseLine(s, L.prompt(stdout('Set model to Haiku 5.5 and saved as your default for new sessions'), { at: T0 + 20 }), { idPrefix: 'a:1', now: T0 }),
    ];
    expect(s.effortCmd).toEqual({ level: 'low', at: T0 + 10 });
    expect(s.modelCmd).toEqual({ label: 'Haiku 5.5', at: T0 + 20 });
    expect(r[1].changed).toBe(true);
    expect(r[1].activities).toEqual([]);
  });

  it('a hora da última resposta com modelo fica guardada', () => {
    const s = createTranscriptState();
    parseLine(s, L.assistant([L.text('oi')], { at: T0 + 5, msgId: 'm1', model: 'claude-haiku-5-5' }), { idPrefix: 'a:1', now: T0 });
    expect(s.model).toBe('claude-haiku-5-5');
    expect(s.modelAt).toBe(T0 + 5);
  });

  it('o mais novo vence ao juntar com o começo do arquivo', () => {
    const tail = createTranscriptState();
    const prefix = createTranscriptState();
    prefix.effortCmd = { level: 'max', at: T0 };
    prefix.modelCmd = { label: 'Opus 5.5', at: T0 };
    mergePrefix(tail, prefix);
    expect(tail.effortCmd).toEqual({ level: 'max', at: T0 });
    const tail2 = createTranscriptState();
    tail2.effortCmd = { level: 'low', at: T0 + 1 };
    mergePrefix(tail2, prefix);
    expect(tail2.effortCmd).toEqual({ level: 'low', at: T0 + 1 });
  });
});
