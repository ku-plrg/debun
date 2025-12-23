import { ESTree } from 'meriyah';

function walk(
  node: ESTree.Node,
  visitors: {
    [key: string]: (node: ESTree.Node) => void;
  }
) {
  const visit = visitors[node.type];
  if (visit) visit(node);

  for (const key in node) {
    const value = (node as any)[key];
    if (key === 'type') continue;

    if (Array.isArray(value)) {
      const len = value.length;
      for (let i = 0; i < len; i++) {
        const child = value[i];
        if (child?.type) walk(child, visitors);
      }
    } else if (value?.type) {
      walk(value, visitors);
    }
  }
}

export default walk;
