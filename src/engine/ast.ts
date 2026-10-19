import type { ErrorCode } from './values';

export type BinaryOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';

interface NodeBase {
  /** Offset of the first character of this node in the formula text. */
  start: number;
  /** Offset just past the last character of this node. */
  end: number;
}

export interface NumberNode extends NodeBase {
  type: 'number';
  value: number;
}
export interface StringNode extends NodeBase {
  type: 'string';
  value: string;
}
export interface BooleanNode extends NodeBase {
  type: 'boolean';
  value: boolean;
}
export interface ErrorNode extends NodeBase {
  type: 'error';
  code: ErrorCode;
}
export interface CellNode extends NodeBase {
  type: 'cell';
  row: number;
  col: number;
  absRow: boolean;
  absCol: boolean;
}
export interface RangeNode extends NodeBase {
  type: 'range';
  top: number;
  left: number;
  bottom: number;
  right: number;
}
export interface UnaryNode extends NodeBase {
  type: 'unary';
  op: '+' | '-';
  operand: Node;
}
export interface PercentNode extends NodeBase {
  type: 'percent';
  operand: Node;
}
export interface BinaryNode extends NodeBase {
  type: 'binary';
  op: BinaryOp;
  left: Node;
  right: Node;
  opStart: number;
}
export interface CallNode extends NodeBase {
  type: 'call';
  name: string;
  args: Node[];
  nameEnd: number;
}
/** An unknown identifier; rejected with #NAME? during validation. */
export interface NameNode extends NodeBase {
  type: 'name';
  name: string;
}
/** An omitted argument, e.g. the middle argument of IF(A1,,0). */
export interface MissingNode extends NodeBase {
  type: 'missing';
}

export type Node =
  | NumberNode
  | StringNode
  | BooleanNode
  | ErrorNode
  | CellNode
  | RangeNode
  | UnaryNode
  | PercentNode
  | BinaryNode
  | CallNode
  | NameNode
  | MissingNode;

/** Visits every node in source order (pre-order, left to right). */
export function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  switch (node.type) {
    case 'unary':
    case 'percent':
      walk(node.operand, visit);
      break;
    case 'binary':
      walk(node.left, visit);
      walk(node.right, visit);
      break;
    case 'call':
      for (const a of node.args) walk(a, visit);
      break;
    default:
      break;
  }
}
