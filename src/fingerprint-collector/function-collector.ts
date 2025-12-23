import { ESTree, parse } from 'meriyah';
import { Expression, Statement } from 'meriyah/dist/src/estree';
import { Function } from '../types/pog';
import walk from '../utils/walk';

const FUNC_ID = true;
let functions: Function[] = [];

function recordFunction(
  node:
    | ESTree.FunctionDeclaration
    | ESTree.FunctionExpression
    | ESTree.ArrowFunctionExpression
): void {
  if (!node.body) return;
  const body = stripFunctions(node.body);
  if (FUNC_ID) {
    if (node.type === 'ArrowFunctionExpression' && node.expression)
      functions.push({
        id: getId(body),
        body: {
          ...node,
          body: body as Expression,
        },
      });
    else
      functions.push({
        id: getId(body),
        body: {
          ...node,
          body: {
            type: 'BlockStatement',
            body: [body as Statement],
          },
        },
      });
    return;
  }

  functions.push({
    body,
  });
}

function stripFunctions(node: ESTree.Node): ESTree.Node {
  if (!node) return node;

  if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  ) {
    if (!node.body) return node;
    recordFunction(node);

    return node.type === 'FunctionDeclaration'
      ? { type: 'EmptyStatement' }
      : ({
          type: node.type,
          id: null,
          params: [],
          generator: false,
          async: false,
          body: {
            type: 'BlockStatement',
            body: [],
          },
        } as ESTree.FunctionExpression | ESTree.ArrowFunctionExpression);
  }

  // Process all child nodes
  Object.entries(node).forEach(([key, value]) => {
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (value[i] && typeof value[i] === 'object') {
            value[i] = stripFunctions(value[i]);
          }
        }
      } else {
        (node as any)[key] = stripFunctions(value);
      }
    }
  });

  return node;
}

// check if JSCA_ id symbol is injected in the function body
function getId(node: ESTree.Node): string {
  let value: string | undefined;
  walk(node, {
    CallExpression(node: ESTree.Node) {
      if (
        node.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        node.callee.name === 'Symbol' &&
        node.arguments.length > 0 &&
        node.arguments[0].type === 'Literal' &&
        typeof node.arguments[0].value === 'string'
      ) {
        const symbolValue = node.arguments[0].value;
        if (value === undefined && symbolValue.startsWith('JSCA_')) {
          value = symbolValue;
        }
      }
    },
    TemplateLiteral(node: ESTree.Node) {
      if (node.type !== 'TemplateLiteral') return;
      const templateValue = node.quasis[0]?.value.raw;
      if (value === undefined && templateValue.startsWith('JSCA_')) {
        value = templateValue;
      }
    },
    Literal(node: ESTree.Node) {
      if (
        node.type === 'Literal' &&
        value === undefined &&
        typeof node.value === 'string' &&
        node.value.startsWith('JSCA_')
      ) {
        value = node.value;
      }
    },
  });
  return value || '';
}

function extractFunctions(code: string): Function[] {
  functions = [];
  let ast: ESTree.Program;
  try {
    ast = parse(code, {
      next: true,
      module: false,
    });
  } catch (e) {
    ast = parse(code, {
      next: true,
      module: true,
    });
  }
  stripFunctions(ast);

  return functions;
}

export default extractFunctions;
