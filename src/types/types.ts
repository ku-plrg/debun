import * as ESTree from 'estree';

export interface Function {
  id?: string;
  body: ESTree.Node;
}
export type POGHash = {
  nodes: number;
  hash: string;
};
export interface POG {
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
export type HashData = Record<
  string,
  Record<string, Record<number, Array<[number, number]>>>
>;
export type LibData = Record<
  number,
  { name: string; versions: string[]; hashCnt: number[] }
>;

export interface EvalOptions {
  SCORE_THRESHOLD: number;
  MIN_FUNCTION_COUNT: number;
  WEB_BLACKLIST_THRESHOLD?: number;
  DUP_THRESHOLD?: number;
}
export interface Score {
  libName: string;
  topVersions: string[];
  type3Versions: string[];
  type2Versions: string[];
}
