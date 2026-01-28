import { parse } from 'meriyah';
import { Function } from '../types/types';
import { walk } from 'estree-walker';
import * as ESTree from 'estree';

type FunctionNode =
  | ESTree.FunctionDeclaration
  | ESTree.FunctionExpression
  | ESTree.ArrowFunctionExpression;

function isFunctionNode(node: ESTree.BaseNode): node is FunctionNode {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
}

function recordFunction(node: FunctionNode, functions: Function[]): void {
  const body = stripFunctions(node.body, functions);
  functions.push({ body });
}

function stripFunctions(node: ESTree.Node, functions: Function[]): ESTree.Node {
  walk(node as ESTree.Node, {
    enter(child) {
      if (isFunctionNode(child)) {
        recordFunction(child, functions);
        const createEmptyBody = (): ESTree.BlockStatement => ({
          type: 'BlockStatement',
          body: [],
        });

        const replacement = (() => {
          if (
            child.type === 'FunctionDeclaration' ||
            child.type === 'FunctionExpression'
          ) {
            return {
              ...child,
              body: createEmptyBody(),
            } as ESTree.FunctionDeclaration | ESTree.FunctionExpression;
          }

          return {
            ...child,
            body: child.expression
              ? ({ type: 'Identifier', name: '_' } as ESTree.Identifier)
              : createEmptyBody(),
          } as ESTree.ArrowFunctionExpression;
        })();

        this.replace(replacement);
        return;
      }
    },
  });

  return node;
}

function extractFunctions(code: string): Function[] {
  const functions: Function[] = [];
  let ast: ESTree.Node | undefined;
  const sourceTypes: Array<'script' | 'module' | 'commonjs'> = [
    'script',
    'module',
    'commonjs',
  ];
  let lastError: unknown;
  for (const sourceType of sourceTypes) {
    try {
      ast = parse(code, {
        next: true,
        sourceType,
      }) as ESTree.Node;
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!ast) throw lastError;

  stripFunctions(ast, functions);
  return functions;
}

export default extractFunctions;
