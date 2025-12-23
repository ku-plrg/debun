import { rapidhash } from 'rapidhash-js';
import { POG, POGHash, POGNode } from '../types/pog';

function toHash(value: string): string {
  return rapidhash(value).toString(16);
}

function hashNode(
  node: POGNode,
  state: Map<number, POGNode>,
  hashMap: Map<number, string>,
  nodeMapping: Map<number, number> = new Map(),
  size: number = 0,
  currentId: { value: number } = { value: 0 }
): {
  hash: string;
  size: number;
} {
  if (nodeMapping.has(node.id)) {
    const loop = state.get(node.id);
    if (loop?.type === 'block' && loop?.loop) {
      return {
        hash: hashMap.get(node.id) || `cycle${nodeMapping.get(node.id)}`,
        size,
      };
    }
    const hash = hashMap.get(node.id);
    if (!hash) throw new Error(`Unexpected loop detected in CFG: ${node.id}`);
    return { hash: hash, size };
  }
  nodeMapping.set(node.id, currentId.value++);

  const hashParts: string[] = [node.type];

  const processNextNode = (nextNodeId: number | undefined) => {
    if (nextNodeId) {
      const nextNode = state.get(nextNodeId);
      if (nextNode) {
        const result = hashNode(
          nextNode,
          state,
          hashMap,
          nodeMapping,
          size,
          currentId
        );
        hashParts.push(result.hash);
        size = result.size;
      }
    }
  };

  size += 1;
  switch (node.type) {
    case 'start':
      processNextNode(node.next);
      break;
    case 'block':
      processNextNode(node.next);
      if (node.op) {
        size += node.op.length;
        node.op.forEach((op) => {
          if (op.type === 'property') hashParts.push(`_.${op.value}`);
          if (op.type === 'property-update')
            hashParts.push(`_.${op.value} = _`);
        });
      }
      break;
    case 'branch':
      processNextNode(node.then);
      processNextNode(node.else);
      break;
    case 'exit':
    case 'exception-exit':
      break;
  }
  const hash = toHash(hashParts.join('|'));
  hashMap.set(node.id, hash);
  return {
    hash: hash,
    size,
  };
}

export function generatePOGHash(f: POG): POGHash {
  const start = f.graph.get(0);

  if (!start) throw new Error('Empty CFG: missing exit node in first graph');

  const result = hashNode(start, f.graph, new Map());
  const pog_hash = result.hash;
  const property_count = result.size;
  return {
    id: f.id,
    nodes: property_count,
    hash: pog_hash,
    body: f.body,
  };
}

function poghash(pogs: POG[]) {
  const hashes = pogs.map(generatePOGHash);
  return hashes;
}

export default poghash;
