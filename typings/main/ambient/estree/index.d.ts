// Generated by typings
// Source: https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/7de6c3dd94feaeb21f20054b9f30d5dabc5efabd/estree/estree.d.ts
// Type definitions for ESTree AST specification
// Project: https://github.com/estree/estree
// Definitions by: RReverser <https://github.com/RReverser>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

declare namespace ESTree {
  interface Node {
    type: string;
    loc?: SourceLocation;
    range?: [number, number];
  }

  interface SourceLocation {
    source?: string;
    start: Position;
    end: Position;
  }

  interface Position {
    line: number;
    column: number;
  }

  interface Program extends Node {
    type: 'Program';
    body: Array<Statement | ModuleDeclaration>;
    sourceType: string;
  }

  interface Function extends Node {
    id?: Identifier;
    params: Array<Pattern>;
    body: BlockStatement | Expression;
    generator: boolean;
  }

  interface Statement extends Node {}

  interface EmptyStatement extends Statement {
    type: 'EmptyStatement';
  }

  interface BlockStatement extends Statement {
    type: 'BlockStatement';
    body: Array<Statement>;
  }

  interface ExpressionStatement extends Statement {
    type: 'ExpressionStatement';
    expression: Expression;
  }

  interface IfStatement extends Statement {
    type: 'IfStatement';
    test: Expression;
    consequent: Statement;
    alternate?: Statement;
  }

  interface LabeledStatement extends Statement {
    type: 'LabeledStatement';
    label: Identifier;
    body: Statement;
  }

  interface BreakStatement extends Statement {
    type: 'BreakStatement';
    label?: Identifier;
  }

  interface ContinueStatement extends Statement {
    type: 'ContinueStatement';
    label?: Identifier;
  }

  interface WithStatement extends Statement {
    type: 'WithStatement';
    object: Expression;
    body: Statement;
  }

  interface SwitchStatement extends Statement {
    type: 'SwitchStatement';
    discriminant: Expression;
    cases: Array<SwitchCase>;
  }

  interface ReturnStatement extends Statement {
    type: 'ReturnStatement';
    argument?: Expression;
  }

  interface ThrowStatement extends Statement {
    type: 'ThrowStatement';
    argument: Expression;
  }

  interface TryStatement extends Statement {
    type: 'TryStatement';
    block: BlockStatement;
    handler?: CatchClause;
    finalizer?: BlockStatement;
  }

  interface WhileStatement extends Statement {
    type: 'WhileStatement';
    test: Expression;
    body: Statement;
  }

  interface DoWhileStatement extends Statement {
    type: 'DoWhileStatement';
    body: Statement;
    test: Expression;
  }

  interface ForStatement extends Statement {
    type: 'ForStatement';
    init?: VariableDeclaration | Expression;
    test?: Expression;
    update?: Expression;
    body: Statement;
  }

  interface _ForInStatement extends Statement {
    left: VariableDeclaration | Expression;
    right: Expression;
    body: Statement;
  }

  interface ForInStatement extends _ForInStatement {
    type: 'ForInStatement';
  }

  interface DebuggerStatement extends Statement {
    type: 'DebuggerStatement';
  }

  interface Declaration extends Statement {}

  interface FunctionDeclaration extends Function, Declaration {
    type: 'FunctionDeclaration';
    id: Identifier;
  }

  interface VariableDeclaration extends Declaration {
    type: 'VariableDeclaration';
    declarations: Array<VariableDeclarator>;
    kind: string;
  }

  interface VariableDeclarator extends Node {
    type: 'VariableDeclarator';
    id: Pattern;
    init?: Expression;
  }

  interface Expression extends Node {}

  interface ThisExpression extends Expression {
    type: 'ThisExpression';
  }

  interface ArrayExpression extends Expression {
    type: 'ArrayExpression';
    elements: Array<Expression | SpreadElement>;
  }

  interface ObjectExpression extends Expression {
    type: 'ObjectExpression';
    properties: Array<Property>;
  }

  interface Property extends Node {
    type: 'Property';
    key: Expression;
    value: Expression;
    kind: string;
    method: boolean;
    shorthand: boolean;
    computed: boolean;
  }

  interface FunctionExpression extends Function, Expression {
    type: 'FunctionExpression';
  }

  interface SequenceExpression extends Expression {
    type: 'SequenceExpression';
    expressions: Array<Expression>;
  }

  interface UnaryExpression extends Expression {
    type: 'UnaryExpression';
    operator: UnaryOperator;
    prefix: boolean;
    argument: Expression;
  }

  interface BinaryExpression extends Expression {
    type: 'BinaryExpression';
    operator: BinaryOperator;
    left: Expression;
    right: Expression;
  }

  interface AssignmentExpression extends Expression {
    type: 'AssignmentExpression';
    operator: AssignmentOperator;
    left: Pattern | MemberExpression;
    right: Expression;
  }

  interface UpdateExpression extends Expression {
    type: 'UpdateExpression';
    operator: UpdateOperator;
    argument: Expression;
    prefix: boolean;
  }

  interface LogicalExpression extends Expression {
    type: 'LogicalExpression';
    operator: LogicalOperator;
    left: Expression;
    right: Expression;
  }

  interface ConditionalExpression extends Expression {
    type: 'ConditionalExpression';
    test: Expression;
    alternate: Expression;
    consequent: Expression;
  }

  interface _CallExpression extends Expression {
    callee: Expression | Super;
    arguments: Array<Expression | SpreadElement>;
  }

  interface CallExpression extends _CallExpression {
    type: 'CallExpression';
  }

  interface NewExpression extends _CallExpression {
    type: 'NewExpression';
  }

  interface MemberExpression extends Expression, Pattern {
    type: 'MemberExpression';
    object: Expression | Super;
    property: Expression;
    computed: boolean;
  }

  interface Pattern extends Node {}

  interface SwitchCase extends Node {
    type: 'SwitchCase';
    test?: Expression;
    consequent: Array<Statement>;
  }

  interface CatchClause extends Node {
    type: 'CatchClause';
    param: Pattern;
    body: BlockStatement;
  }

  interface Identifier extends Node, Expression, Pattern {
    type: 'Identifier';
    name: string;
  }

  interface Literal extends Node, Expression {
    type: 'Literal';
    value?: string | boolean | number | RegExp;
  }

  interface RegExpLiteral extends Literal {
    regex: {
      pattern: string;
      flags: string;
    };
  }

  type UnaryOperator = string;

  type BinaryOperator = string;

  type LogicalOperator = string;

  type AssignmentOperator = string;

  type UpdateOperator = string;

  interface ForOfStatement extends _ForInStatement {
    type: 'ForOfStatement';
  }

  interface Super extends Node {
    type: 'Super';
  }

  interface SpreadElement extends Node {
    type: 'SpreadElement';
    argument: Expression;
  }

  interface ArrowFunctionExpression extends Function, Expression {
    type: 'ArrowFunctionExpression';
    expression: boolean;
  }

  interface YieldExpression extends Expression {
    type: 'YieldExpression';
    argument?: Expression;
    delegate: boolean;
  }

  interface TemplateLiteral extends Expression {
    type: 'TemplateLiteral';
    quasis: Array<TemplateElement>;
    expressions: Array<Expression>;
  }

  interface TaggedTemplateExpression extends Expression {
    type: 'TaggedTemplateExpression';
    tag: Expression;
    quasi: TemplateLiteral;
  }

  interface TemplateElement extends Node {
    type: 'TemplateElement';
    tail: boolean;
    value: {
      cooked: string;
      raw: string;
    };
  }

  interface AssignmentProperty extends Property {
    value: Pattern;
    kind: string;
    method: boolean;
  }

  interface ObjectPattern extends Pattern {
    type: 'ObjectPattern';
    properties: Array<AssignmentProperty>;
  }

  interface ArrayPattern extends Pattern {
    type: 'ArrayPattern';
    elements: Array<Pattern>;
  }

  interface RestElement extends Pattern {
    type: 'RestElement';
    argument: Pattern;
  }

  interface AssignmentPattern extends Pattern {
    type: 'AssignmentPattern';
    left: Pattern;
    right: Expression;
  }

  interface Class extends Node {
    id?: Identifier;
    superClass: Expression;
    body: ClassBody;
  }

  interface ClassBody extends Node {
    type: 'ClassBody';
    body: Array<MethodDefinition>;
  }

  interface MethodDefinition extends Node {
    type: 'MethodDefinition';
    key: Expression;
    value: FunctionExpression;
    kind: string;
    computed: boolean;
    static: boolean;
  }

  interface ClassDeclaration extends Class, Declaration {
    type: 'ClassDeclaration';
    id: Identifier;
  }

  interface ClassExpression extends Class, Expression {
    type: 'ClassExpression';
  }

  interface MetaProperty extends Expression {
    type: 'MetaProperty';
    meta: Identifier;
    property: Identifier;
  }

  interface ModuleDeclaration extends Node {}

  interface ModuleSpecifier extends Node {
    local: Identifier;
  }

  interface ImportDeclaration extends ModuleDeclaration {
    type: 'ImportDeclaration';
    specifiers: Array<ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier>;
    source: Literal;
  }

  interface ImportSpecifier extends ModuleSpecifier {
    type: 'ImportSpecifier';
    imported: Identifier;
  }

  interface ImportDefaultSpecifier extends ModuleSpecifier {
    type: 'ImportDefaultSpecifier';
  }

  interface ImportNamespaceSpecifier extends ModuleSpecifier {
    type: 'ImportNamespaceSpecifier';
  }

  interface ExportNamedDeclaration extends ModuleDeclaration {
    type: 'ExportNamedDeclaration';
    declaration?: Declaration;
    specifiers: Array<ExportSpecifier>;
    source?: Literal;
  }

  interface ExportSpecifier extends ModuleSpecifier {
    type: 'ExportSpecifier';
    exported: Identifier;
  }

  interface ExportDefaultDeclaration extends ModuleDeclaration {
    type: 'ExportDefaultDeclaration';
    declaration: Declaration | Expression;
  }

  interface ExportAllDeclaration extends ModuleDeclaration {
    type: 'ExportAllDeclaration';
    source: Literal;
  }
}