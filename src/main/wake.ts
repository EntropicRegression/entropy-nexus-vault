import type { NodeCrystal, RequestWakeResult } from '../shared/types';

export const wakeEndpoint = 'entropy-nexus://wake';

interface WakeNode {
  status: NodeCrystal['status'];
  canWake: boolean;
  nodeName: string;
  sessionId: string | null;
}

interface WakeDispatch {
  findNode: (id: string) => Promise<WakeNode | null>;
  registered: (url: string) => boolean;
  open: (url: string) => Promise<void>;
}

export async function requestWakeForNode(nodeId: unknown, dispatch: WakeDispatch): Promise<RequestWakeResult> {
  // Match the console's parseWakeUrl allowlist. The caller supplies only a node ID.
  if (typeof nodeId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(nodeId)) {
    return { ok: false, reason: 'invalid-node', nodeName: null, sessionId: null };
  }
  const node = await dispatch.findNode(nodeId);
  if (!node || node.status !== '封存' || !node.canWake) {
    return { ok: false, reason: 'not-wakeable', nodeName: node?.nodeName ?? null, sessionId: null };
  }
  const { nodeName, sessionId } = node;
  try {
    if (!dispatch.registered(wakeEndpoint)) return { ok: false, reason: 'unregistered', nodeName, sessionId };
    await dispatch.open(wakeEndpoint + '?node=' + encodeURIComponent(nodeId));
    return { ok: true };
  } catch {
    return { ok: false, reason: 'rejected', nodeName, sessionId };
  }
}
