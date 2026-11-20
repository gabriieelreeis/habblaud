import { describe, expect, it } from 'vitest';
import { formReply, OPENCODE_DESTINATION, parseForm, parsePermission, permissionReply, permissionView } from './permission';

const SES = 'ses_main0000000000000000001';

describe('pedidos de permissão do OpenCode', () => {
  it('parsePermission lê o Permission.Request (e recusa sem id, sessão ou ação)', () => {
    expect(parsePermission({ id: 'per_1', sessionID: SES, action: 'bash', resources: ['git status', 7, ''], save: ['git status *'], metadata: { x: 1 }, message: ' olha ' })).toEqual({
      id: 'per_1',
      sessionId: SES,
      action: 'bash',
      resources: ['git status'],
      save: ['git status *'],
      metadata: { x: 1 },
      message: 'olha',
    });
    expect(parsePermission({ id: 'per_1', sessionID: SES })).toBeUndefined();
    expect(parsePermission({ sessionID: SES, action: 'bash' })).toBeUndefined();
    expect(parsePermission(null)).toBeUndefined();
  });

  it('bash: os comandos na caixa "$" e o "sempre" com as regras que o OpenCode guardaria', () => {
    const v = permissionView(parsePermission({ id: 'per_1', sessionID: SES, action: 'bash', resources: ['npm test', 'git push'], save: ['npm test *', 'git push *'] })!);
    expect(v).toMatchObject({ tool: 'Bash', inputKind: 'command', input: 'npm test\ngit push' });
    expect(v.title.startsWith('Bash(npm test')).toBe(true);
    expect(v.suggestions).toEqual([{ index: 0, rules: ['bash(npm test *)', 'bash(git push *)'], destination: OPENCODE_DESTINATION }]);
  });

  it('edit: o arquivo no título e o diff do metadata na prévia', () => {
    const v = permissionView(parsePermission({ id: 'per_2', sessionID: SES, action: 'edit', resources: ['src/a.ts'], save: ['*'], metadata: { filepath: 'src/a.ts', diff: '-a\n+b' } })!);
    expect(v).toMatchObject({ tool: 'Edit', title: 'Edit(src/a.ts)', input: '-a\n+b', inputKind: 'diff' });
    expect(v.suggestions?.[0].rules).toEqual(['edit(*)']);
  });

  it('pasta externa, ferramenta de MCP e pedido sem "sempre"', () => {
    const ext = permissionView(parsePermission({ id: 'per_3', sessionID: SES, action: 'external_directory', resources: ['D:\\ReisCorp\\outra\\*'] })!);
    expect(ext).toMatchObject({ tool: 'external_directory', title: 'Pasta externa(D:\\ReisCorp\\outra)', icon: '📁' });
    expect(ext.suggestions).toBeUndefined();
    const mcp = permissionView(parsePermission({ id: 'per_4', sessionID: SES, action: 'github_create_issue', resources: ['*'], save: ['*'], metadata: { input: { title: 'x' } } })!);
    expect(mcp).toMatchObject({ tool: 'github_create_issue', title: 'github_create_issue', inputKind: 'json' });
    expect(mcp.input).toContain('"title": "x"');
  });

  it('permissionReply: aprovar = once, "sempre" = always, recusar = reject (com o motivo); o resto não vai', () => {
    expect(permissionReply({ behavior: 'allow' })).toEqual({ decision: 'once' });
    expect(permissionReply({ behavior: 'allow', suggestion: 0 })).toEqual({ decision: 'always' });
    expect(permissionReply({ behavior: 'deny' })).toEqual({ decision: 'reject' });
    expect(permissionReply({ behavior: 'deny', message: 'use pnpm' })).toEqual({ decision: 'reject', message: 'use pnpm' });
    expect(permissionReply({ behavior: 'terminal' })).toBeUndefined();
  });
});

describe('perguntas do OpenCode (formulários)', () => {
  const field = (over: Record<string, unknown> = {}) => ({ key: 'q0', title: 'Banco', description: 'Qual banco?', type: 'string', options: [{ value: 'pg', label: 'Postgres' }, { value: 'redis', label: 'Redis' }], ...over });

  it('parseForm: escolha única e várias viram perguntas; campo que o cartão não mostra deixa a pergunta só no OpenCode', () => {
    const f = parseForm({ id: 'frm_1', sessionID: SES, title: 'Questions', fields: [field(), field({ key: 'q1', type: 'multiselect', description: 'Testes?', title: undefined, custom: true })] })!;
    expect(f.questions).toEqual([
      { index: 0, question: 'Qual banco?', header: 'Banco', options: [{ index: 0, label: 'Postgres' }, { index: 1, label: 'Redis' }] },
      { index: 1, question: 'Testes?', multiSelect: true, options: [{ index: 0, label: 'Postgres' }, { index: 1, label: 'Redis' }] },
    ]);
    expect(parseForm({ id: 'frm_2', sessionID: SES, fields: [{ key: 'n', type: 'number' }] })).toBeUndefined();
    expect(parseForm({ id: 'frm_3', sessionID: SES, fields: [{ key: 'u', type: 'external', url: 'https://x' }] })).toBeUndefined();
    expect(parseForm({ id: 'frm_4', sessionID: SES, fields: [] })).toBeUndefined();
  });

  it('formReply: o valor da opção (ou o texto livre) de cada campo; várias = lista', () => {
    const f = parseForm({ id: 'frm_1', sessionID: SES, fields: [field(), field({ key: 'q1', type: 'multiselect', custom: true })] })!;
    expect(formReply(f, [{ question: 0, options: [1] }, { question: 1, options: [0], other: 'MySQL' }])).toEqual({ answer: { q0: 'redis', q1: ['pg', 'MySQL'] } });
    expect(formReply(f, [{ question: 0, options: [1] }])).toBeUndefined();
    expect(formReply(f, [{ question: 0, options: [9] }, { question: 1, options: [0] }])).toBeUndefined();
    const fixo = parseForm({ id: 'frm_5', sessionID: SES, fields: [field({ custom: false })] })!;
    expect(formReply(fixo, [{ question: 0, other: 'outro' }])).toBeUndefined();
  });
});
