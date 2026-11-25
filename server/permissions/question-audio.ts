import { randomBytes } from 'node:crypto';
import type { AskQuestion } from '../../shared/types';
import { fileType, normalizedPath, pathProblem } from '../deliveries/files';

const AUDIO_PATH_RE = /(?:[a-z]:\/|\/)[^\s"'`<>(){}|,;]*?\.(?:wav|mp3|ogg|opus|m4a)(?![a-z0-9])/gi;
const AUDIO_TTL_MS = 30 * 60_000;
const MAX_FILES = 64;

export interface QuestionAudioEntry {
  id: string;
  path: string;
  type: string;
  name: string;
  createdAt: number;
}

export interface QuestionAudioOptions {
  id?: () => string;
  now?: () => number;
  ttlMs?: number;
  max?: number;
}

/** Arquivos de áudio liberados pelas perguntas pendentes, por id opaco (nunca por caminho). */
export class QuestionAudioStore {
  private readonly files = new Map<string, QuestionAudioEntry>();

  constructor(private readonly opts: QuestionAudioOptions = {}) {}

  add(path: string): QuestionAudioEntry | undefined {
    if (pathProblem(path)) return undefined;
    const type = fileType(path);
    if (!type?.type.startsWith('audio/')) return undefined;
    this.expire();
    const now = this.opts.now?.() ?? Date.now();
    const entry: QuestionAudioEntry = {
      id: this.opts.id?.() ?? randomBytes(9).toString('base64url'),
      path: normalizedPath(path),
      type: type.type,
      name: path.split(/[\\/]/).filter(Boolean).pop()?.slice(0, 120) ?? 'audio',
      createdAt: now,
    };
    this.files.set(entry.id, entry);
    while (this.files.size > (this.opts.max ?? MAX_FILES)) {
      const oldest = this.files.keys().next().value;
      if (oldest === undefined) break;
      this.files.delete(oldest);
    }
    return entry;
  }

  get(id: string): QuestionAudioEntry | undefined {
    this.expire();
    return this.files.get(id);
  }

  private expire(): void {
    const now = this.opts.now?.() ?? Date.now();
    for (const [id, entry] of this.files) {
      if (now - entry.createdAt >= (this.opts.ttlMs ?? AUDIO_TTL_MS)) this.files.delete(id);
    }
  }
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\\/g, '/') : '';
}

/** Caminhos absolutos de áudio no texto da pergunta e nas descrições das opções. */
export function questionAudioPaths(question: unknown): string[] {
  const raw = question && typeof question === 'object' ? (question as Record<string, unknown>) : {};
  const texts = [textOf(raw.question)];
  if (Array.isArray(raw.options)) {
    for (const option of raw.options) {
      if (option && typeof option === 'object') texts.push(textOf((option as Record<string, unknown>).description));
    }
  }
  const paths: string[] = [];
  for (const text of texts) {
    for (const match of text.matchAll(AUDIO_PATH_RE)) paths.push(match[0]);
  }
  return paths;
}

/** Liga o player à pergunta quando há áudio válido; sem áudio, devolve a pergunta como veio. */
export function withQuestionAudio(questions: AskQuestion[] | undefined, raw: unknown, store: QuestionAudioStore): AskQuestion[] | undefined {
  if (!questions?.length) return questions;
  const rawQuestions = Array.isArray(raw) ? raw : [];
  return questions.map((q) => {
    for (const path of questionAudioPaths(rawQuestions[q.index])) {
      const entry = store.add(path);
      if (entry) return { ...q, audio: { name: entry.name, url: `/api/permissions/audio/${encodeURIComponent(entry.id)}` } };
    }
    return q;
  });
}
