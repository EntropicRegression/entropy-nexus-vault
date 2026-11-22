import { describe, expect, it, vi } from 'vitest';
import { requestWakeForNode } from './wake';

const archived = { status: '封存' as const, canWake: true, nodeName: '合成節點', sessionId: 'synthetic-session' };
const dispatch = () => ({
  findNode: vi.fn(async (_id: string) => archived),
  registered: vi.fn(() => true),
  open: vi.fn(async (_url: string) => {}),
});

describe('喚醒只能送出固定路由', () => {
  it.each(['../node', '../', 'https://wake?node=node', 'file:///C:/test', 'entropy-nexus://other?node=node',
    'entropy-nexus://wake?node=node', 'node&action=other', 'node%00', 'node?other=foo', 'node\n', 'a'.repeat(65), ''])(
    '拒絕不合法的節點 ID %j', async (id) => {
      const actions = dispatch();
      expect(await requestWakeForNode(id, actions)).toMatchObject({ ok: false, reason: 'invalid-node' });
      expect(actions.findNode).not.toHaveBeenCalled();
      expect(actions.registered).not.toHaveBeenCalled();
      expect(actions.open).not.toHaveBeenCalled();
    });

  it('存在且可喚醒時只送出指定協定與 node 查詢參數', async () => {
    const actions = dispatch();
    expect(await requestWakeForNode('synthetic-Node_01', actions)).toEqual({ ok: true });
    expect(actions.registered).toHaveBeenCalledWith('entropy-nexus://wake');
    expect(actions.open).toHaveBeenCalledExactlyOnceWith('entropy-nexus://wake?node=synthetic-Node_01');
  });

  it.each(['_node', '-node', '_', 'a'.repeat(64)])('接受主控台允許的邊界 ID %s', async (id) => {
    const actions = dispatch();
    expect(await requestWakeForNode(id, actions)).toEqual({ ok: true });
    expect(actions.open).toHaveBeenCalledExactlyOnceWith('entropy-nexus://wake?node=' + id);
  });

  it('未知、現役、純紀念節點都不傳送', async () => {
    const actions = dispatch();
    for (const node of [null, { ...archived, status: '線上' as const }, { ...archived, canWake: false }]) {
      expect(await requestWakeForNode('valid-id', { ...actions, findNode: async () => node }))
        .toMatchObject({ ok: false, reason: 'not-wakeable', sessionId: null });
    }
    expect(actions.open).not.toHaveBeenCalled();
  });

  it('協定不存在或被作業系統拒絕時回明確退路，不回傳系統例外', async () => {
    const actions = dispatch();
    actions.registered.mockReturnValueOnce(false);
    expect(await requestWakeForNode('valid-id', actions)).toEqual({
      ok: false, reason: 'unregistered', nodeName: archived.nodeName, sessionId: archived.sessionId,
    });
    expect(actions.open).not.toHaveBeenCalled();
    actions.open.mockRejectedValueOnce(new Error('private local detail'));
    expect(await requestWakeForNode('valid-id', actions)).toEqual({
      ok: false, reason: 'rejected', nodeName: archived.nodeName, sessionId: archived.sessionId,
    });
  });
});
