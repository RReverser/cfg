import 'better-log/install';
import 'source-map-support/register';
import { parse } from 'acorn';
import { readFileSync, writeFileSync } from 'fs';
import { generate } from 'escodegen';

type ReusableExpr = ESTree.Identifier | ESTree._SimpleLiteral | ESTree.Identifier & { name: 'undefined' };

interface GotoStmt {
	stmt: ESTree.Statement;
}

interface GotoInsert {
	insert(): void;
}

interface GotoResolve {
	resolve(): void;
}

interface GotoArg extends ESTree._SimpleLiteral {
	value?: string;
}

interface BranchingGotoArg extends ESTree.ConditionalExpression {
	test: ReusableExpr;
	consequent: GotoArg;
	alternate: GotoArg;
}

interface GotoCall<A extends GotoArg | BranchingGotoArg> extends ESTree.CallExpression {
	callee: ESTree.Identifier & { name: 'GOTO' };
	arguments: [A];
}

interface GotoStatement<A extends GotoArg | BranchingGotoArg> extends ESTree.ExpressionStatement {
	expression: GotoCall<A>;
}

type BlockBody = (ESTree.ExpressionStatement | GotoStatement<any> | ESTree.DebuggerStatement)[];

interface Block extends ESTree.LabeledStatement {
	body: ESTree.BlockStatement & { body: BlockBody };
}

interface TempVar extends ESTree.Identifier {
	refCounter: number;
}

function isTempVar(node: ESTree.Expression): node is TempVar {
	return is(node, 'Identifier') && typeof (node as TempVar).refCounter === 'number';
}

function isSimpleLiteral(node: ESTree.Expression): node is ESTree._SimpleLiteral {
	return is(node, 'Literal') && !(node.value instanceof RegExp);
}

function is(node: ESTree.Node, type: 'Identifier'): node is ESTree.Identifier;
function is(node: ESTree.Node, type: 'MemberExpression'): node is ESTree.MemberExpression;
function is(node: ESTree.Node, type: 'VariableDeclaration'): node is ESTree.VariableDeclaration;
function is(node: ESTree.Node, type: 'Literal'): node is ESTree.Literal;
function is(node: ESTree.Node, type: 'FunctionExpression'): node is ESTree.FunctionExpression;
function is(node: ESTree.Node, type: string): boolean {
	return node.type === type;
}

const build = {
	ident<T extends string>(name: T): ESTree.Identifier & { name: T } {
		return {
			type: 'Identifier',
			name
		};
	},

	literal<T extends string | boolean | number>(value?: T): ESTree.Literal & { value?: T } {
		return {
			type: 'Literal',
			value
		};
	},

	exprStmt<T extends ESTree.Expression>(expression: T): ESTree.ExpressionStatement & { expression: T } {
		return {
			type: 'ExpressionStatement',
			expression
		};
	},

	callExpr<C extends ESTree.Expression, A extends any[]>(callee: C, args: A): ESTree.CallExpression & { callee: C, arguments: A } {
		return {
			type: 'CallExpression',
			callee,
			arguments: args
		};
	},

	binExpr<L extends ESTree.Expression, O extends ESTree.BinaryOperator, R extends ESTree.Expression>(left: L, operator: O, right: R): ESTree.BinaryExpression & { left: L, operator: O, right: R } {
		return {
			type: 'BinaryExpression',
			left,
			operator,
			right
		};
	},

	unExpr<O extends ESTree.UnaryOperator, T extends ESTree.Expression>(operator: O, argument: T): ESTree.UnaryExpression & { operator: O, argument: T } {
		return {
			type: 'UnaryExpression',
			operator,
			argument
		};
	},

	gotoStmt<A extends GotoArg | BranchingGotoArg>(arg: A): GotoStatement<A> {
		return build.exprStmt(build.callExpr(build.ident<'GOTO'>('GOTO'), [arg] as [A]));
	},

	undef() {
		return build.ident<'undefined'>('undefined');
	},

	emptyStmt(): ESTree.EmptyStatement {
		return {
			type: 'EmptyStatement'
		};
	},

	varDeclarator<L extends ESTree.Identifier, R extends ESTree.Expression | undefined>(id: L, init?: R): ESTree.VariableDeclarator & { id: L, init?: R } {
		return {
			type: 'VariableDeclarator',
			id,
			init
		};
	},

	varDeclaration(declarations: ESTree.VariableDeclarator[]): ESTree.VariableDeclaration {
		return {
			type: 'VariableDeclaration',
			kind: 'var',
			declarations
		};
	},

	assignExpr<L extends ESTree.Identifier, O extends ESTree.AssignmentOperator, R extends ESTree.Expression>(left: L, operator: O, right: R): ESTree.AssignmentExpression & { left: L, operator: O, right: R } {
		return {
			type: 'AssignmentExpression',
			left,
			operator,
			right
		};
	},

	branchingGotoStmt(test: ReusableExpr, consequent: GotoArg, alternate: GotoArg): GotoStatement<BranchingGotoArg> {
		return build.gotoStmt<BranchingGotoArg>({
			type: 'ConditionalExpression',
			test,
			consequent,
			alternate
		});
	},

	program(body: ESTree.Statement[]): ESTree.Program {
		return {
			type: 'Program',
			body
		};
	}
};

class Goto {
	private _gotoArg: GotoArg = build.literal<string>();

	constructor(private _context: Context) {}

	getForInsertion() {
		return this._gotoArg;
	}

	insert() {
		this._context.currentBlock.push(build.gotoStmt(this.getForInsertion()));
		this._context.startBlock();
	}

	resolve() {
		if (this._gotoArg.value !== undefined) {
			throw new Error('GOTO was already resolved.');
		}
		this._gotoArg.value = this._context.startBlock();
	}
}

class Context {
	static __RESULT = build.ident('__RESULT')
	static __ERROR = build.ident('__ERROR');

	varCounter = 0;
	freeVars: TempVar[] = [];

	scopeVars = new Map<string, ESTree.VariableDeclarator>();

	varBlock: BlockBody;

	blocks: Block[] = [];
	currentBlock: BlockBody;

	labelStack: { name: string, goto: GotoInsert | undefined }[] = [];
	pendingBreaks: { name: string, goto: GotoResolve }[] = [];
	pendingReturns: GotoResolve[] = [];
	pendingThrows: GotoResolve[] = [];

	startBlock() {
		if (this.currentBlock && this.currentBlock.length === 0) {
			return this.blocks[this.blocks.length - 1].label.name;
		}
		const name = `B${this.blocks.length}`;
		this.blocks.push({
			type: 'LabeledStatement',
			label: build.ident(name),
			body: {
				type: 'BlockStatement' as 'BlockStatement',
				body: this.currentBlock = []
			}
		});
		return name;
	}

	addScopeVar(id: ESTree.Identifier) {
		let scopeVar = this.scopeVars.get(id.name);
		if (scopeVar === undefined) {
			scopeVar = build.varDeclarator(id);
			this.scopeVars.set(id.name, scopeVar);
		}
		return scopeVar;
	}

	constructor() {
		this.startBlock();
		this.varBlock = this.currentBlock;
	}

	assign(id: ESTree.Identifier, init: ESTree.Expression, insert?: boolean) {
		const stmt = build.exprStmt(build.assignExpr(id, '=', this.transformExpr(init)));
		if (insert !== false) {
			this.currentBlock.push(stmt);
		}
		return stmt;
	}

	execForeign(name: string, args: ESTree.Expression[]) {
		const evaluatedArgs = args.map(arg => this.useTempVar(arg));
		this.currentBlock.push(build.exprStmt(build.callExpr(build.ident(name), evaluatedArgs)));
		for (const arg of evaluatedArgs) {
			this.freeTempVar(arg);
		}
		const branch = this.createBranch(Context.__ERROR);
		branch.insert();
		this.pendingThrows.push(branch.consequent);
		branch.alternate.resolve();
		return Context.__RESULT;
	}

	useTempVar(init: ESTree.Expression): ReusableExpr {
		if (isTempVar(init)) {
			init.refCounter++;
			return init;
		}
		if (isSimpleLiteral(init) || is(init, 'Identifier') && init.name === 'undefined' || init === Context.__ERROR) {
			return init;
		}
		let id = this.freeVars.pop();
		if (!id) {
			id = Object.assign(build.ident(`$${this.varCounter++}`), { refCounter: 0 });
			this.addScopeVar(id);
		}
		id.refCounter++;
		this.assign(id, init);
		return id;
	}

	freeTempVar(id: ReusableExpr) {
		if (isTempVar(id) && id.refCounter > 0) {
			--id.refCounter;
			if (id.refCounter === 0) {
				this.freeVars.push(id);
			}
		}
	}

	shadowVar(id: ESTree.Identifier, init: ESTree.Expression) {
		this.addScopeVar(id);

		const outerParam = this.useTempVar(id);

		this.assign(id, init);

		return {
			unshadow: () => {
				this.assign(id, outerParam);
				this.freeTempVar(outerParam);
			}
		};
	}

	_createGoto() {
		return new Goto(this);
	}

	createGotoToHere(): GotoInsert {
		const goto = this._createGoto();
		goto.resolve();
		return goto;
	}

	insertPendingGoto(): GotoResolve {
		const goto = this._createGoto();
		goto.insert();
		return goto;
	}

	createBranch(test: ESTree.Expression, consequent = this._createGoto(), alternate = this._createGoto()): { insert: () => void, consequent: GotoResolve, alternate: GotoResolve } {
		test = this.useTempVar(test);
		const branch = build.branchingGotoStmt(test, consequent.getForInsertion(), alternate.getForInsertion());
		this.freeTempVar(test);
		return {
			insert: () => {
				this.currentBlock.push(branch);
				this.startBlock();
			},
			consequent,
			alternate
		};
	}

	insertBranchStart(test: ESTree.Expression): GotoResolve {
		const branch = this.createBranch(test);
		branch.insert();
		branch.consequent.resolve();
		return branch.alternate;
	}

	intoBlock(name: string, canContinue: boolean) {
		this.labelStack.push({
			name,
			goto: canContinue ? this.createGotoToHere() : undefined
		});
	}

	leaveBlock() {
		let endingLabel: ESTree.Identifier;
		const label = this.labelStack.pop();
		if (!label) {
			throw new Error('Attempted to leave block when there was none.');
		}
		const { name } = label;
		this.pendingBreaks = this.pendingBreaks.filter((brk, i) => {
			if (brk.name === name) {
				brk.goto.resolve();
				return false;
			} else {
				return true;
			}
		});
	}

	leave() {
		if (this.varCounter !== this.freeVars.length) {
			throw new Error(`Attempted to leave the context with ${this.varCounter - this.freeVars.length} locked registers`);
		}
		if (this.labelStack.length > 0) {
			throw new Error(`Attempted to leave the context with non-empty label stack: ${this.labelStack.map(label => label.name).join(', ')}`);
		}
		if (this.pendingBreaks.length > 0) {
			throw new Error(`Attempted to leave the context with unresolved break statements: ${this.pendingBreaks.map(label => label.name).join(', ')}`);
		}
		for (const err of this.pendingThrows) {
			err.resolve();
		}
		for (const ret of this.pendingReturns) {
			ret.resolve();
		}
		for (const varDecl of this.scopeVars.values()) {
			if (varDecl.init) {
				this.varBlock.push(this.assign(varDecl.id, varDecl.init, false));
				varDecl.init = undefined;
			}
		}
	}

	transformStmt(stmt: ESTree.Statement) {
		if (!(stmt.type in stmtHandlers)) {
			throw new ReferenceError(`Unhandled type ${stmt.type}.`);
		}
		let lockedVars = this.varCounter - this.freeVars.length;
		stmtHandlers[stmt.type](this, stmt);
		lockedVars = this.varCounter - this.freeVars.length - lockedVars;
		if (lockedVars) {
			throw new Error(`Attempted to leave ${stmt.type} handler with ${lockedVars} locked registers.`);
		}
	}

	transformExpr(expr: ESTree.Expression) {
		if (!(expr.type in exprHandlers)) {
			throw new ReferenceError(`Unhandled type ${expr.type}.`);
		}
		let lockedVars = this.varCounter - this.freeVars.length;
		const evaluatedExpr = exprHandlers[expr.type](this, expr);
		lockedVars = this.varCounter - this.freeVars.length - lockedVars;
		if (lockedVars) {
			throw new Error(`Attempted to leave ${expr.type} handler with ${lockedVars} locked registers.`);
		}
		return evaluatedExpr;
	}
}

const stmtHandlers: { [type: string]: (context: Context, item: ESTree.Statement) => void } = {
	ExpressionStatement(context: Context, node: ESTree.ExpressionStatement) {
		context.transformExpr(node.expression);
	},

	DebuggerStatement(context: Context, node: ESTree.DebuggerStatement) {
		context.currentBlock.push(node);
	},

	LabeledStatement(context: Context, node: ESTree.LabeledStatement) {
		context.intoBlock(node.label.name, /^((Do)?While|For(In)?)Statement$/.test(node.body.type));
		context.transformStmt(node.body);
		context.leaveBlock();
	},

	BlockStatement(context: Context, node: ESTree.BlockStatement) {
		for (const stmt of node.body) {
			context.transformStmt(stmt);
		}
	},

	BreakStatement(context: Context, node: ESTree.BreakStatement) {
		context.pendingBreaks.push({
			name: node.label ? node.label.name : '',
			goto: context.insertPendingGoto()
		});
	},

	ReturnStatement(context: Context, node: ESTree.ReturnStatement) {
		if (node.argument) {
			context.assign(Context.__RESULT, node.argument);
		}
		context.pendingReturns.push(context.insertPendingGoto());
	},

	ContinueStatement(context: Context, node: ESTree.ContinueStatement) {
		let i = context.labelStack.length - 1;
		const name = node.label ? node.label.name : '';
		for (; i >= 0; i--) {
			const item = context.labelStack[i];
			if (item.goto) {
				if (item.name === name || !name) {
					item.goto.insert();
					return;
				}
			}
		}
		throw new ReferenceError(`Continue to invalid label ${name}`);
	},

	IfStatement(context: Context, node: ESTree.IfStatement) {
		const rejectBranch = context.insertBranchStart(node.test);
		context.transformStmt(node.consequent);
		if (node.alternate) {
			const fulfillBranch = context.insertPendingGoto();
			rejectBranch.resolve();
			context.transformStmt(node.alternate);
			fulfillBranch.resolve();
		} else {
			rejectBranch.resolve();
		}
	},

	WhileStatement(context: Context, node: ESTree.WhileStatement) {
		const start = context.createGotoToHere();
		const rejectBranch = context.insertBranchStart(node.test);
		context.intoBlock('', true);
		context.transformStmt(node.body);
		start.insert();
		rejectBranch.resolve();
		context.leaveBlock();
	},

	DoWhileStatement(context: Context, node: ESTree.DoWhileStatement) {
		const branch = context.createBranch(node.test);
		branch.consequent.resolve();
		context.intoBlock('', true);
		context.transformStmt(node.body);
		branch.insert();
		context.leaveBlock();
		branch.alternate.resolve();
	},

	ForStatement(context: Context, node: ESTree.ForStatement) {
		if (node.init) {
			context.transformStmt(is(node.init, 'VariableDeclaration') ? node.init : build.exprStmt(node.init));
		}
		const start = context.createGotoToHere();
		const rejectBranch = node.test && context.insertBranchStart(node.test);
		context.intoBlock('', true);
		context.transformStmt(node.body);
		if (node.update) {
			context.transformStmt(build.exprStmt(node.update));
		}
		start.insert();
		if (rejectBranch) {
			rejectBranch.resolve();
		}
		context.leaveBlock();
	},

	EmptyStatement(context: Context, node: ESTree.EmptyStatement) {},

	SwitchStatement(context: Context, node: ESTree.SwitchStatement) {
		context.intoBlock('', false);
		let prevLeave: GotoResolve = { resolve() {} };
		const localId = context.useTempVar(node.discriminant);
		const defaultCase = node.cases.reduce<{
			to: GotoResolve,
			consequent: ESTree.Statement[],
			from: GotoInsert
		} | undefined>((defaultCase, switchCase) => {
			if (switchCase.test) {
				const rejectBranch = context.insertBranchStart(build.binExpr(localId, '===', switchCase.test));
				prevLeave.resolve();
				for (const stmt of switchCase.consequent) {
					context.transformStmt(stmt);
				}
				prevLeave = context.insertPendingGoto();
				rejectBranch.resolve();
				return defaultCase;
			} else {
				return {
					to: prevLeave,
					consequent: switchCase.consequent,
					from: prevLeave = context._createGoto()
				};
			}
		}, undefined);
		context.freeTempVar(localId);
		if (defaultCase) {
			defaultCase.to.resolve();
			for (const stmt of defaultCase.consequent) {
				context.transformStmt(stmt);
			}
			defaultCase.from.insert();
		}
		prevLeave.resolve();
		context.leaveBlock();
	},

	VariableDeclaration(context: Context, node: ESTree.VariableDeclaration) {
		for (const decl of node.declarations) {
			context.addScopeVar(decl.id);
			if (decl.init) {
				context.assign(decl.id, decl.init);
			}
		}
	},

	FunctionDeclaration(context: Context, node: ESTree.FunctionDeclaration) {
		context.addScopeVar(node.id).init = Object.assign(node, {
			type: 'FunctionExpression' as 'FunctionExpression'
		});
	},

	ThrowStatement(context: Context, node: ESTree.ThrowStatement) {
		context.assign(Context.__ERROR, node.argument);
		context.pendingThrows.push(context.insertPendingGoto());
	},

	TryStatement(context: Context, node: ESTree.TryStatement) {
		context.transformStmt(node.block);
		if (node.handler && context.pendingThrows.length > 0) {
			const allGood = context.insertPendingGoto();

			for (const goto of context.pendingThrows) {
				goto.resolve();
			}

			context.pendingThrows = [];

			const outerVar = context.shadowVar(node.handler.param, Context.__ERROR);
			context.assign(Context.__ERROR, build.undef());

			context.transformStmt(node.handler.body);

			outerVar.unshadow();

			allGood.resolve();
		}
		if (node.finalizer) {
			context.transformStmt(node.finalizer);
		}
	},

	WithStatement(context: Context, node: ESTree.WithStatement) {
		throw new Error('Why?!!!');
	}
};

const exprHandlers: { [type: string]: (context: Context, item: ESTree.Expression) => ESTree.Expression } = {
	Literal(context: Context, node: ESTree.Literal) {
		return node;
	},

	Identifier(context: Context, node: ESTree.Identifier) {
		return node;
	},

	FunctionExpression(context: Context, node: ESTree.FunctionExpression) {
		const funcContext = new Context();
		funcContext.transformStmt(node.body);
		node.body.body = funcContext.blocks;
		funcContext.leave();
		return node;
	},

	MemberExpression(context: Context, node: ESTree.MemberExpression) {
		let { object, property } = node;
		if (!node.computed) {
			property = build.literal((property as ESTree.Identifier).name);
		}
		return context.execForeign('GET_PROPERTY', [object, property]);
	},

	AssignmentExpression(context: Context, node: ESTree.AssignmentExpression) {
		if (is(node.left, 'MemberExpression')) {
			let { object, property } = node.left;
			if (!node.left.computed) {
				property = build.literal((property as ESTree.Identifier).name);
			}
			return context.execForeign('SET_PROPERTY', [object, property, node.right]);
		} else {
			context.assign(node.left, node.right);
			return node.left;
		}
	},

	CallExpression(context: Context, node: ESTree.CallExpression) {
		let thisExpr: ReusableExpr | undefined;
		const { callee } = node;
		if (is(callee, 'MemberExpression')) {
			thisExpr = callee.object = context.useTempVar(callee.object);
		}
		const result = context.execForeign('CALL', [callee, thisExpr || build.undef(), ...node.arguments]);
		if (thisExpr) {
			context.freeTempVar(thisExpr);
		}
		return result;
	},

	UnaryExpression(context: Context, node: ESTree.UnaryExpression) {
		const arg = context.useTempVar(node.argument);
		const unExpr = build.unExpr(node.operator, arg);
		context.freeTempVar(arg);
		return unExpr;
	},

	BinaryExpression(context: Context, node: ESTree.BinaryExpression) {
		const left = context.useTempVar(node.left);
		const right = context.useTempVar(node.right);
		const binExpr = build.binExpr(left, node.operator, right);
		context.freeTempVar(left);
		context.freeTempVar(right);
		return binExpr;
	}
};

{
	const ast = parse(readFileSync('test.js', 'utf-8'), { ecmaVersion: 5, locations: true });

	const context = new Context();
	context.addScopeVar(Context.__ERROR);
	context.addScopeVar(Context.__RESULT);
	for (const stmt of ast.body) {
		context.transformStmt(stmt);
	}
	context.leave();

	writeFileSync('test.out.js', generate(build.program([
		build.varDeclaration([...context.scopeVars.values()]),
		...context.blocks
	]), { comment: true }));
}