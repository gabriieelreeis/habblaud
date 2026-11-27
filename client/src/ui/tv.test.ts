import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../../../shared/types';
import { BackdropCloseGuard, imageFailureText, roomMains } from './tv';

const agent = (id: string, over: Partial<AgentInfo>): AgentInfo => ({ id, kind: 'main', roomId: 'r1', status: 'idle', ...over }) as AgentInfo;

describe('TV: quem recebe o pedido', () => {
  it('só os agentes principais presentes na sala', () => {
    const list = roomMains(
      [
        agent('a', {}),
        agent('b', { kind: 'sub' }),
        agent('c', { roomId: 'r2' }),
        agent('d', { status: 'offline' }),
        agent('e', { status: 'done' }),
        agent('f', { status: 'working' }),
      ],
      'r1',
    );
    expect(list.map((a) => a.id)).toEqual(['a', 'f']);
  });
});

describe('TV: clique no fundo depois de abrir no celular', () => {
  const dialog = {} as EventTarget;
  const outro = {} as EventTarget;

  it('ignora o clique sintético que vem logo após o toque na TV', () => {
    const guard = new BackdropCloseGuard();
    guard.arm(1000);
    expect(guard.shouldClose(dialog, dialog, 1010)).toBe(false);
    expect(guard.shouldClose(dialog, dialog, 1400)).toBe(false);
  });

  it('um toque de verdade no fundo, depois da folga, ainda fecha', () => {
    const guard = new BackdropCloseGuard();
    guard.arm(1000);
    expect(guard.shouldClose(dialog, dialog, 1401)).toBe(true);
  });

  it('cliques dentro da janela nunca fecham', () => {
    const guard = new BackdropCloseGuard();
    guard.arm(1000);
    expect(guard.shouldClose(outro, dialog, 5000)).toBe(false);
  });

  it('sem abertura registrada, nada fecha pelo fundo', () => {
    expect(new BackdropCloseGuard().shouldClose(dialog, dialog, 5000)).toBe(false);
  });
});

describe('TV: aviso no lugar da imagem que não carrega', () => {
  it('caminho absoluto explica que é de fora e cita o auxiliar', () => {
    const text = imageFailureText('D:\\GitHub\\app\\docs\\tela.png');
    expect(text).toContain('tela.png');
    expect(text).toContain('fora da pasta');
    expect(text).toContain('auxiliar do computador');
  });

  it('caminho de rede também conta como fora da pasta', () => {
    expect(imageFailureText('\\\\servidor\\docs\\tela.png')).toContain('fora da pasta');
  });

  it('caminho relativo só orienta a copiar para a pasta', () => {
    const text = imageFailureText('evidencias/tela.png');
    expect(text).toContain('tela.png');
    expect(text).toContain('copie o arquivo para a pasta da apresentação');
    expect(text).not.toContain('auxiliar');
  });

  it('sem nome no caminho, o aviso diz "imagem"', () => {
    expect(imageFailureText('pasta/')).toContain('imagem');
  });
});
