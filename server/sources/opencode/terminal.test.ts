import { describe, expect, it } from 'vitest';
import { conversationOf } from './terminal';

describe('terminal do OpenCode: conversa a partir das mensagens', () => {
  it('pedido, raciocínio, ferramenta com resultado e resposta, na ordem; mensagem ainda escrevendo fica de fora', () => {
    const msgs = [
      { id: 'msg_3', type: 'assistant', time: { created: 30, completed: 40 }, content: [{ type: 'reasoning', text: 'pensando' }, { type: 'text', text: 'Pronto.' }] },
      { id: 'msg_1', type: 'user', text: '"leia a.txt"', time: { created: 10 } },
      {
        id: 'msg_2',
        type: 'assistant',
        time: { created: 20, completed: 25 },
        content: [{ type: 'tool', id: 'call_1', name: 'shell', state: { status: 'completed', input: { command: 'cat a.txt' }, content: [{ type: 'text', text: 'olá\r\n' }] }, time: { created: 21, completed: 22 } }],
      },
      { id: 'msg_4', type: 'assistant', time: { created: 50 }, content: [{ type: 'text', text: 'escreven' }, { type: 'tool', id: 'call_2', name: 'read', state: { status: 'running', input: { filePath: 'b.txt' } } }] },
      { id: 'msg_5', type: 'system', text: 'instruções', time: { created: 60 } },
      { id: 'msg_6', type: 'idle', outcome: 'interrupted', time: { created: 70 } },
    ];
    const out = conversationOf(msgs, 'C:\p');
    expect(out.map((e) => [e.kind, e.id])).toEqual([
      ['user', 'msg_1'],
      ['tool', 'call_1'],
      ['result', 'call_1:r'],
      ['thinking', 'msg_3:0'],
      ['assistant', 'msg_3:1'],
      ['tool', 'call_2'],
      ['system', 'msg_6:i'],
    ]);
    expect(out[0]).toMatchObject({ text: 'leia a.txt' });
    expect(out[1]).toMatchObject({ tool: 'Bash', title: 'Bash(cat a.txt)', input: 'cat a.txt', inputKind: 'command' });
    expect(out[2]).toMatchObject({ toolUseId: 'call_1', text: 'olá' });
    expect(out[5]).toMatchObject({ tool: 'Read', title: 'Read(b.txt)' });
  });

  it('ferramenta com erro e execução que falhou', () => {
    const out = conversationOf([
      { id: 'msg_1', type: 'assistant', time: { created: 1, completed: 2 }, content: [{ type: 'tool', id: 'c', name: 'edit', state: { status: 'error', input: { filePath: 'x.ts', oldString: 'a', newString: 'b' }, error: { message: 'oldString não encontrado' } } }] },
      { id: 'msg_2', type: 'idle', outcome: 'failed', error: { message: 'limite atingido' }, time: { created: 3 } },
    ]);
    expect(out[0]).toMatchObject({ kind: 'tool', tool: 'Edit', inputKind: 'diff' });
    expect(out[1]).toMatchObject({ kind: 'result', error: true, text: 'oldString não encontrado' });
    expect(out[2]).toMatchObject({ kind: 'system', level: 'error', text: 'limite atingido' });
  });
});
