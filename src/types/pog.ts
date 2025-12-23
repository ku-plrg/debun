import { ESTree } from 'meriyah';

export interface Function {
  id?: string;
  body: ESTree.Node;
}
export type POGHash = {
  id?: string;
  nodes: number;
  hash: string;
  body: ESTree.Node;
};
export interface POG {
  id?: string;
  body: ESTree.Node;
  graph: Map<number, POGNode>;
}

export type POGNodeBase = {
  id: number;
  type: 'start' | 'exit' | 'exception-exit' | 'block' | 'branch';
};

export interface POGNodeStart extends POGNodeBase {
  type: 'start';
  next?: number;
}

export interface POGNodeBranch extends POGNodeBase {
  type: 'branch';
  then?: number;
  else?: number;
}
export interface POGNodeBlock extends POGNodeBase {
  type: 'block';
  next?: number;
  op?: Op[];
  loop: boolean;
}
export interface Getter {
  type: 'property';
  value: string;
}
export interface Setter {
  type: 'property-update';
  value: string;
}

export interface POGNodeEnd extends POGNodeBase {
  type: 'exit' | 'exception-exit';
}
export type Op = Getter | Setter;
export type POGNode = POGNodeStart | POGNodeEnd | POGNodeBranch | POGNodeBlock;
export type Value = 'top' | 'truthy' | 'falsy' | 'pos' | 'neg' | 'bottom';
export type Env = Record<string, Value>;
export type PrevId = [POGNode, Env, boolean?];
export interface POGState {
  currentId: number;
  nodes: Map<number, POGNode>;
  prevIds: PrevId[];
  loopStack: { break: PrevId[]; continue: PrevId[] }[];
  endId: number;
  exceptionId: number;
}
