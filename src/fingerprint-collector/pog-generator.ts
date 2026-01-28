import * as ESTree from 'estree';
import { walk } from 'estree-walker';
import { builtIns } from '../utils/builtins';
import {
  Env,
  Function,
  Op,
  POG,
  POGNode,
  POGState,
  PrevId,
} from '../types/types';

const RESULT = '@@RESULT';
const IGNORE_TYPEOF = true;
const SKIP_BUILTIN: string[] = builtIns;

const BRANCH_BYPASSING = true;
const PATH_CLONING = true;
const BRANCH_FLIPPING = true;

const EXPRESSION_TYPES: ReadonlySet<ESTree.Expression['type']> = new Set([
  'ArrayExpression',
  'ArrowFunctionExpression',
  'AssignmentExpression',
  'AwaitExpression',
  'BinaryExpression',
  'CallExpression',
  'ChainExpression',
  'ClassExpression',
  'ConditionalExpression',
  'FunctionExpression',
  'Identifier',
  'ImportExpression',
  'Literal',
  'LogicalExpression',
  'MemberExpression',
  'MetaProperty',
  'NewExpression',
  'ObjectExpression',
  'SequenceExpression',
  'TaggedTemplateExpression',
  'TemplateLiteral',
  'ThisExpression',
  'UnaryExpression',
  'UpdateExpression',
  'YieldExpression',
]);

function isExpression(node: ESTree.Node): node is ESTree.Expression {
  return EXPRESSION_TYPES.has(node.type as ESTree.Expression['type']);
}
function is_typeof(node: ESTree.ConditionalExpression): boolean {
  return (
    node.consequent.type === 'Literal' &&
    node.consequent.value === 'undefined' &&
    node.test.type === 'BinaryExpression' &&
    node.test.operator === '===' &&
    node.test.left.type === 'UnaryExpression' &&
    node.test.left.operator === 'void' &&
    node.test.left.argument.type === 'Literal' &&
    node.test.left.argument.value === 0 &&
    IGNORE_TYPEOF
  );
}

function createNode(
  type: 'branch' | 'block',
  pogState: POGState,
  loop?: boolean,
  value?: Op
): POGNode {
  const id = pogState.currentId++;
  const node: POGNode =
    type === 'branch'
      ? { id, type, then: undefined, else: undefined }
      : {
          id,
          type,
          next: undefined,
          loop: loop ?? false,
          op: value ? [value] : undefined,
        };
  pogState.nodes.set(id, node);
  return node;
}
function connect(to: number, pogState: POGState) {
  pogState.prevIds.forEach((from) => connectPair(from, to, pogState));
}
function connectPair(from: PrevId, to: number, pogState: POGState) {
  const [node, env, context] = from;
  switch (node.type) {
    case 'branch':
      if (node.then && node.else) throw new Error('Condition has 2 branches');
      if (context) {
        node.then = to;
      } else {
        node.else = to;
      }
      return;
    case 'block':
      if (node.next) throw new Error('Node has already been connected');
      node.next = to;
      return;
    case 'start':
      if (node.next) throw new Error('Start Node has already been connected');
      node.next = to;
      return;
  }
}
function connect_end(pogState: POGState) {
  connect(pogState.endId, pogState);
  pogState.prevIds = [];
}

function addemptyBranch(pogState: POGState): [PrevId[], PrevId[]] {
  const thenPrevIds: PrevId[] = [];
  const elsePrevIds: PrevId[] = [];
  const condition = createNode('branch', pogState);
  thenPrevIds.push([condition, {}, true]);
  elsePrevIds.push([condition, {}, false]);
  connect(condition.id, pogState);
  return [thenPrevIds, elsePrevIds];
}
function addBranch(
  node: ESTree.Node,
  pogState: POGState
): [PrevId[], PrevId[]] {
  visit(node, pogState);
  const truthy: PrevId[] = [];
  const falsy: PrevId[] = [];
  const top: PrevId[] = [];
  const neg: PrevId[] = [];
  const pos: PrevId[] = [];

  for (const prevId of pogState.prevIds) {
    const [node, env, context] = prevId;
    switch (env[RESULT]) {
      case 'top':
      case undefined:
        top.push(prevId);
        break;
      case 'pos':
        pos.push(prevId);
        break;
      case 'neg':
        neg.push(prevId);
        break;
      case 'truthy':
        truthy.push(prevId);
        break;
      case 'falsy':
        falsy.push(prevId);
        break;
      case 'bottom':
        break;
    }
  }
  const thenPrevIds: PrevId[] = [];
  const elsePrevIds: PrevId[] = [];
  const shouldCreateBranch = pos.length > 0 || neg.length > 0 || top.length > 0;
  const env = merge(pogState.prevIds);
  if (!BRANCH_BYPASSING) {
    const [thenprev, elseprev] = addemptyBranch(pogState);
    return neg.length > pos.length && BRANCH_FLIPPING
      ? [elseprev, thenprev]
      : [thenprev, elseprev];
  }

  if (shouldCreateBranch) {
    const condition = createNode('branch', pogState);
    thenPrevIds.push([condition, { ...env }, true]);
    elsePrevIds.push([condition, { ...env }, false]);
    pogState.prevIds = [...pos, ...neg, ...top];
    connect(condition.id, pogState);
  }

  return neg.length > pos.length && BRANCH_FLIPPING
    ? [elsePrevIds.concat(truthy), thenPrevIds.concat(falsy)]
    : [thenPrevIds.concat(truthy), elsePrevIds.concat(falsy)];
}
function addOp(operator: Op, pogState: POGState) {
  if (PATH_CLONING) {
    pogState.prevIds.forEach((from) => {
      if (from[0].type === 'block') {
        if (from[0].op) from[0].op?.push(operator);
        else from[0].op = [operator];
        pogState.nodes.set(from[0].id, from[0]);
      } else {
        const node = createNode('block', pogState, false, operator);
        connectPair(from, node.id, pogState);
        from[0] = node;
        from[1] = {};
        from[2] = undefined;
      }
    });
  } else {
    if (pogState.prevIds.length === 1) {
      const node = pogState.prevIds[0][0];
      if (node.type === 'block') {
        if (node.op) node.op.push(operator);
        else node.op = [operator];
        pogState.nodes.set(node.id, node);
        return;
      }
    }
    const node = createNode('block', pogState, false, operator);
    connect(node.id, pogState);
    pogState.prevIds = [[node, {}]];
  }
}
function addLoop(pogState: POGState) {
  const node = createNode('block', pogState, true, undefined);
  connect(node.id, pogState);
  pogState.prevIds = [[node, {}]];
  return node;
}
function loopVisitor(node: ESTree.Node, pogState: POGState) {
  pogState.loopStack.push({ break: [], continue: [] });
  visit(node, pogState);
  const loop = pogState.loopStack.pop();
  if (!loop) throw new Error('Loop stack is empty');
  return loop;
}
function endLoop(
  loop: { break: PrevId[]; continue: PrevId[] },
  id: number,
  prevIds: PrevId[],
  pogState: POGState
) {
  pogState.prevIds = loop.continue.concat(pogState.prevIds);
  connect(id, pogState);
  pogState.prevIds = loop.break.concat(prevIds);
}

function merge(prevIds: PrevId[]): Env {
  const envs = prevIds.map(([, env]) => env);
  return envs.reduce(join, {});
}
function join(left: Env, right: Env): Env {
  const result: Env = {};
  for (const key in left) {
    const leftValue = left[key];
    const rightValue = right[key];
    if (leftValue === rightValue) {
      result[key] = leftValue;
    } else if (leftValue === 'bottom') {
      result[key] = rightValue;
    } else if (rightValue === 'bottom') {
      result[key] = leftValue;
    } else {
      delete result[key];
    }
  }
  return result;
}

function visit(node: ESTree.Node, pogState: POGState): void {
  walk(node, {
    enter(child: any) {
      switch (child.type) {
        case 'BreakStatement':
          const loop_break = pogState.loopStack.pop();
          if (!loop_break) return;
          loop_break.break.push(...pogState.prevIds);
          pogState.loopStack.push(loop_break);
          pogState.prevIds = [];
          return;
        case 'ContinueStatement':
          const loop_continue = pogState.loopStack.pop();
          if (!loop_continue) return;
          loop_continue.continue.push(...pogState.prevIds);
          pogState.loopStack.push(loop_continue);
          pogState.prevIds = [];
          return;
        case 'IfStatement': {
          this.skip();
          const [thenPrevIds, elsePrevIds] = addBranch(child.test, pogState);
          pogState.prevIds = thenPrevIds;
          visit(child.consequent, pogState);
          const thenPrev = [...pogState.prevIds];
          pogState.prevIds = elsePrevIds;
          child.alternate && visit(child.alternate, pogState);
          pogState.prevIds = thenPrev.concat(pogState.prevIds);
          return;
        }
        case 'ThrowStatement':
          this.skip();
          visit(child.argument, pogState);
          connect(pogState.exceptionId, pogState);
          pogState.prevIds = [];
          return;
        case 'WhileStatement': {
          this.skip();
          const whileLoop = addLoop(pogState);
          const [thenPrevIds, elsePrevIds] = addBranch(child.test, pogState);
          pogState.prevIds = thenPrevIds;
          const whileLoopstack = loopVisitor(child.body, pogState);
          endLoop(whileLoopstack, whileLoop.id, elsePrevIds, pogState);
          return;
        }
        case 'DoWhileStatement': {
          this.skip();
          const doWhileLoop = addLoop(pogState);
          const doWhileLoopstack = loopVisitor(child.body, pogState);
          const [thenPrevIds, elsePrevIds] = addBranch(child.test, pogState);
          pogState.prevIds = thenPrevIds;
          endLoop(doWhileLoopstack, doWhileLoop.id, elsePrevIds, pogState);
          return;
        }
        case 'ForStatement': {
          this.skip();
          child.init && visit(child.init, pogState);
          const forLoop = addLoop(pogState);
          if (child.test) {
            const [thenPrevIds, elsePrevIds] = addBranch(child.test, pogState);
            pogState.prevIds = thenPrevIds;
            const forLoopstack = loopVisitor(child.body, pogState);
            child.update && visit(child.update, pogState);
            endLoop(forLoopstack, forLoop.id, elsePrevIds, pogState);
          } else {
            const forLoopstack = loopVisitor(child.body, pogState);
            endLoop(forLoopstack, forLoop.id, [], pogState);
          }
          return;
        }
        case 'ForInStatement':
        case 'ForOfStatement':
          this.skip();
          visit(child.left, pogState);
          child.right && visit(child.right, pogState);
          const forInLoop = addLoop(pogState);
          const [thenPrevIds, elsePrevIds] = addemptyBranch(pogState);
          pogState.prevIds = thenPrevIds;
          const forInLoopstack = loopVisitor(child.body, pogState);
          endLoop(forInLoopstack, forInLoop.id, elsePrevIds, pogState);
          return;
        case 'SwitchStatement':
          this.skip();
          pogState.loopStack.push({ break: [], continue: [] });
          visit(child.discriminant, pogState);
          child.cases.forEach((c: ESTree.SwitchCase) => {
            c.test && visit(c.test, pogState);
            const [thenPrevIds, elsePrevIds] = addemptyBranch(pogState);
            pogState.prevIds = thenPrevIds;
            c.consequent.forEach((node) => visit(node, pogState));
            pogState.prevIds = elsePrevIds.concat(pogState.prevIds);
          });
          const switchcase = pogState.loopStack.pop();
          if (!switchcase) throw new Error('Loop stack is empty');
          pogState.prevIds = switchcase.break.concat(pogState.prevIds);
          return;
        case 'VariableDeclaration':
          this.skip();
          child.declarations.forEach((decl: ESTree.VariableDeclarator) => {
            if (!decl.init) return;
            visit(decl.init, pogState);
            if (decl.id.type === 'Identifier') {
              const name = decl.id.name;
              pogState.prevIds.forEach(([node, env, context]) => {
                env[name] = env[RESULT];
              });
            }
          });
          return;
        case 'Identifier':
          const name = child.name;
          pogState.prevIds.forEach(([node, env, context]) => {
            env[RESULT] = env[name] ?? 'pos';
          });
          return;
        case 'Literal': {
          const v = child.value;
          const isFalsy =
            v === null || v === 0 || v === false || v === '' || v === 0n;
          pogState.prevIds.forEach(([_, env]: any) => {
            env[RESULT] = isFalsy ? 'falsy' : 'truthy';
          });
          return;
        }
        case 'ObjectExpression':
          this.skip();
          const properties = child.properties
            .filter((p: any) => p.type === 'Property')
            .filter(
              (p: any) =>
                ![
                  'AssignmentPattern',
                  'ObjectPattern',
                  'ArrayPattern',
                ].includes(p.value.type)
            );
          properties.forEach((prop: any) => {
            visit(prop.key, pogState);
            visit(prop.value, pogState);

            const key =
              prop.key.type === 'Identifier'
                ? prop.key.name
                : prop.key.type === 'Literal' &&
                    typeof prop.key.value === 'string'
                  ? prop.key.value
                  : '[]';

            addOp({ type: 'property-update', value: key }, pogState);
          });

          pogState.prevIds.forEach(([_, env]: any) => {
            env[RESULT] = 'truthy';
          });
          return;
        case 'UnaryExpression':
          this.skip();
          if (child.operator === '!') {
            visit(child.argument, pogState);
            pogState.prevIds.forEach(([node, env, context]) => {
              switch (env[RESULT]) {
                case 'truthy':
                  env[RESULT] = 'falsy';
                  break;
                case 'falsy':
                  env[RESULT] = 'truthy';
                  break;
                case 'pos':
                  env[RESULT] = 'neg';
                  break;
                case 'neg':
                  env[RESULT] = 'pos';
                  break;
                case 'bottom':
                  env[RESULT] = 'bottom';
                  break;
              }
            });
          } else {
            visit(child.argument, pogState);
            pogState.prevIds.forEach(([node, env, context]) => {
              env[RESULT] = 'pos';
            });
          }
          return;
        case 'UpdateExpression':
          this.skip();
          visit(child.argument, pogState);
          if (child.argument.type === 'MemberExpression') {
            visit(child.argument.object, pogState);
            visit(child.argument.property, pogState);
            const value =
              !child.argument.computed &&
              child.argument.property.type === 'Identifier'
                ? child.argument.property.name
                : child.argument.computed &&
                    child.argument.property.type === 'Literal' &&
                    typeof child.argument.property.value === 'string'
                  ? child.argument.property.value
                  : '[]';
            addOp(
              {
                type: 'property-update',
                value,
              },
              pogState
            );
          }
          pogState.prevIds.forEach(([node, env, context]) => {
            env[RESULT] = 'pos';
          });
          return;
        case 'AssignmentExpression':
          this.skip();
          if (child.left.type === 'MemberExpression') {
            visit(child.left.object, pogState);
            visit(child.left.property, pogState);
            visit(child.right, pogState);
            const value =
              !child.left.computed && child.left.property.type === 'Identifier'
                ? child.left.property.name
                : child.left.computed &&
                    child.left.property.type === 'Literal' &&
                    typeof child.left.property.value === 'string'
                  ? child.left.property.value
                  : '[]';
            addOp(
              {
                type: 'property-update',
                value,
              },
              pogState
            );
            pogState.prevIds.forEach(([node, env, context]) => {
              env[RESULT] = 'pos';
            });
            return;
          }
          if (child.left.type === 'Identifier') {
            visit(child.right, pogState);
            const name = child.left.name;
            pogState.prevIds.forEach(([node, env, context]) => {
              env[name] = env[RESULT];
              env[RESULT] = 'pos';
            });
            return;
          }
          return;
        case 'LogicalExpression': {
          this.skip();
          if (child.operator === '&&') {
            const [thenPrevIds, elsePrevIds] = addBranch(child.left, pogState);
            pogState.prevIds = thenPrevIds;
            visit(child.right, pogState);
            elsePrevIds.forEach(
              ([node, env, context]) => (env[RESULT] = 'falsy')
            );
            pogState.prevIds = pogState.prevIds.concat(elsePrevIds);
            return;
          } else if (child.operator === '||') {
            const [thenPrevIds, elsePrevIds] = addBranch(child.left, pogState);
            pogState.prevIds = elsePrevIds;
            visit(child.right, pogState);
            thenPrevIds.forEach(
              ([node, env, context]) => (env[RESULT] = 'truthy')
            );
            pogState.prevIds = pogState.prevIds.concat(thenPrevIds);
            return;
          } else {
            visit(child.left, pogState);
            const [thenPrevIds, elsePrevIds] = addemptyBranch(pogState);
            pogState.prevIds = thenPrevIds;
            visit(child.right, pogState);
            elsePrevIds.forEach(
              ([node, env, context]) => (env[RESULT] = 'falsy')
            );
            pogState.prevIds = pogState.prevIds.concat(elsePrevIds);
          }
          return;
        }
        case 'MemberExpression':
          this.skip();
          if (
            child.object.type === 'Identifier' &&
            SKIP_BUILTIN.includes(child.object.name)
          ) {
            visit(child.property, pogState);
            pogState.prevIds.forEach(([node, env, context]) => {
              env[RESULT] = 'pos';
            });
            return;
          }
          visit(child.object, pogState);
          visit(child.property, pogState);
          const value =
            !child.computed && child.property.type === 'Identifier'
              ? child.property.name
              : child.computed &&
                  child.property.type === 'Literal' &&
                  typeof child.property.value === 'string'
                ? child.property.value
                : '[]';
          addOp(
            {
              type: 'property',
              value,
            },
            pogState
          );
          pogState.prevIds.forEach(([node, env, context]) => {
            env[RESULT] = 'pos';
          });
          return;
        case 'ConditionalExpression': {
          this.skip();
          if (is_typeof(child)) {
            pogState.prevIds.forEach(([node, env, context]) => {
              env[RESULT] = 'pos';
            });
            return;
          }
          const [thenPrevIds, elsePrevIds] = addBranch(child.test, pogState);
          pogState.prevIds = thenPrevIds;
          visit(child.consequent, pogState);
          const thenPrev = [...pogState.prevIds];
          pogState.prevIds = elsePrevIds;
          visit(child.alternate, pogState);
          pogState.prevIds = thenPrev.concat(pogState.prevIds);
          return;
        }
        case 'CallExpression':
        case 'NewExpression':
          this.skip();
          visit(child.callee, pogState);
          child.arguments.forEach((arg: ESTree.Node) => visit(arg, pogState));
          pogState.prevIds.forEach((prevId) => {
            prevId[1] = {};
            prevId[1][RESULT] = 'pos';
          });
          return;
        default:
          return;
      }
    },
    leave(child: any) {
      switch (child.type) {
        case 'ReturnStatement':
          connect_end(pogState);
          return;
        case 'ArrayExpression':
          pogState.prevIds.forEach(([_, env]: any) => {
            env[RESULT] = 'pos';
          });
          return;
        case 'BinaryExpression':
          if (
            child.operator === '!==' ||
            child.operator === '!=' ||
            child.operator === '>=' ||
            child.operator === '<='
          ) {
            pogState.prevIds.forEach(([node, env, context]) => {
              env[RESULT] = 'neg';
            });
          } else
            pogState.prevIds.forEach(([node, env, context]) => {
              env[RESULT] = 'pos';
            });
          return;
        default:
          if (isExpression(child)) {
            pogState.prevIds.forEach(([_, env]: any) => {
              env[RESULT] = 'pos';
            });
          }
          return;
      }
    },
  });
}

export function extractPOG(node: ESTree.Node): POGState {
  const start: POGNode = { id: 0, type: 'start' };
  const pogState: POGState = {
    currentId: 1,
    prevIds: [[start, {}]],
    nodes: new Map<number, POGNode>([
      [0, start],
      [-1, { type: 'exit', id: -1 }],
      [-2, { type: 'exception-exit', id: -2 }],
    ]),
    loopStack: [],
    endId: -1,
    exceptionId: -2,
  };
  visit(node, pogState);
  connect_end(pogState);
  return pogState;
}

function pog(functions: Function[]): POG[] {
  return functions.map((func) => {
    const graph = extractPOG(func.body);

    return {
      graph: graph.nodes,
    };
  });
}

export default pog;
