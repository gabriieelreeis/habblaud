import { describe, expect, it } from 'vitest';
import type { AskQuestion } from '../../shared/types';
import { QuestionAudioStore, withQuestionAudio } from './question-audio';

const question = (text: string): AskQuestion => ({ index: 0, question: text, options: [{ index: 0, label: 'Enviar' }] });

const openStore = () => new QuestionAudioStore({ id: () => 'audio1234' });

describe('audio in AskUserQuestion', () => {
  it('turns a Windows or POSIX path in the question into a player without touching the disk', () => {
    for (const text of ['Ouça: D:\\ReisCorp\\voz.wav', 'Ouça: /tmp/voz-2026.wav']) {
      const store = openStore();
      const [result] = withQuestionAudio([question(text)], [{ index: 0, question: text, options: [] }], store)!;
      expect(result.audio).toEqual({ name: text.includes('D:') ? 'voz.wav' : 'voz-2026.wav', url: '/api/permissions/audio/audio1234' });
      expect(store.get('audio1234')).toMatchObject({ type: 'audio/wav', name: result.audio!.name });
    }
  });

  it('keeps a host path for the file reader to check when the audio is played', () => {
    const store = openStore();
    const text = 'Ouça: C:\\Users\\Reis\\AppData\\Local\\Temp\\habblaud-audio-test\\voz-teste.wav';
    withQuestionAudio([question(text)], [{ index: 0, question: text, options: [] }], store);
    expect(store.get('audio1234')?.path).toBe('C:/Users/Reis/AppData/Local/Temp/habblaud-audio-test/voz-teste.wav');
  });

  it('reads option descriptions too, with the right content type', () => {
    const store = openStore();
    const raw = { question: 'Enviar a voz?', options: [{ label: 'Enviar', description: 'Ouça: C:/tmp/voz.mp3 antes' }] };
    const q: AskQuestion = { index: 0, question: raw.question, options: [{ index: 0, label: 'Enviar', description: raw.options[0].description }] };
    const [result] = withQuestionAudio([q], [raw], store)!;
    expect(result.audio?.name).toBe('voz.mp3');
    expect(store.get('audio1234')?.type).toBe('audio/mpeg');
  });

  it('refuses secrets and paths outside the file rules', () => {
    const store = openStore();
    for (const text of ['Ouça: D:/Users/a/.ssh/id_rsa.wav', 'Ouça: /Users/a/senha.wav', 'Ouça: voz.wav', 'Ouça: /tmp/voz.txt']) {
      const [result] = withQuestionAudio([question(text)], [{ index: 0, question: text, options: [] }], store)!;
      expect(result.audio, text).toBeUndefined();
    }
    expect(store.get('audio1234')).toBeUndefined();
  });

  it('leaves a question without audio exactly as it came', () => {
    const q = question('Enviar a mensagem?');
    const result = withQuestionAudio([q], [{ index: 0, question: q.question, options: [] }], openStore());
    expect(result).toEqual([q]);
  });
});
