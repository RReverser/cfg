import 'better-log/install';
import 'source-map-support/register';
import { parse } from 'acorn';
import { readFileSync, writeFileSync } from 'fs';
import { generate } from 'escodegen';

interface GotoStmt {
	stmt: ESTree.Statement;
}

interface GotoInsert {
	insert(): void;
}

interface GotoResolve {
	resolve(): void;
}

type GotoCall = ESTree.CallExpression & {
	callee: ESTree.Identifier & { name: 'GOTO' },
	arguments: [ESTree.Literal & { value: number }]
};

type GotoStatement = ESTree.ExpressionStatement & {
	expression: GotoCall
};

type BranchingGotoStatement = ESTree.IfStatement & {
	consequent: GotoStatement,
	alternate?: undefined
};

type SimplifiedAssignmentExpression = ESTree.AssignmentExpression & {
	left: ESTree.Identifier,
	operator: '='
};

class Goto {
	private _inserted = false;
	private _confirmed = false;
	private _gotoArg: ESTree.Literal = { type: 'Literal', value: undefined };

	private _stmt: GotoStatement = {
		type: 'ExpressionStatement',
		expression: {
			type: 'CallExpression',
			callee: { type: 'Identifier', name: 'GOTO' },
			arguments: [this._gotoArg]
		} as GotoCall
	};

	constructor(private _context: Context) {}

	private _confirm() {
		if (this._confirmed) return;
		if (this._inserted) {
			const pos = this._gotoArg.value;
			if (pos !== undefined) {
				this._context.hadGotos.add(pos);
				this._confirmed = true;
			}
		}
	}
	
	getForInsertion() {
		this._inserted = true;
		this._confirm();
		return this._stmt;
	}

	insert() {
		this._context.statements.push(this.getForInsertion());
	}

	resolve() {
		if (this._gotoArg.value !== undefined) {
			throw new Error('GOTO was already resolved.');
		}
		this._gotoArg.value = this._context.pos();
		this._confirm();
	}
}

class Context {
	static UNDEF: ESTree.Identifier = { type: 'Identifier', name: 'undefined' };
	static __RESULT: ESTree.Identifier = { type: 'Identifier', name: '__RESULT' };
	static __ERROR: ESTree.Identifier = { type: 'Identifier', name: '__ERROR' };

	varCounter = 0;
	freeVars: ESTree.Identifier[] = [];

	scopeVars = new Map<string, ESTree.VariableDeclarator>();

	statements: (ESTree.ExpressionStatement | ESTree.EmptyStatement | GotoStatement | BranchingGotoStatement | ESTree.DebuggerStatement)[] = [];

	labelCounter = 0;

	labelStack: { name: string, goto: GotoInsert | undefined }[] = [];
	pendingBreaks: { name: string, goto: GotoResolve }[] = [];
	pendingReturns: GotoResolve[] = [];
	pendingThrows: GotoResolve[] = [];

	hadGotos = new Set();

	addScopeVar(id: ESTree.Identifier) {
		let scopeVar = this.scopeVars.get(id.name);
		if (scopeVar === undefined) {
			scopeVar = {
				type: 'VariableDeclarator',
				id
			};
			this.scopeVars.set(id.name, scopeVar);
		}
		return scopeVar;
	}

	constructor(public isFunction: boolean) {
		this.addScopeVar(Context.__ERROR);
	}

	pos(): number {
		return this.statements.length;
	}

	assign(id: ESTree.Identifier, init: ESTree.Expression, insert?: boolean) {
		const stmt = {
			type: 'ExpressionStatement',
			expression: {
				type: 'AssignmentExpression',
				left: id,
				operator: '=',
				right: this.transformExpr(init)
			} as ESTree.AssignmentExpression
		} as ESTree.ExpressionStatement;
		if (insert) {
			this.statements.push(stmt);
		}
		return stmt;
	}

	useTempVar(init: ESTree.Expression) {
		let id = this.freeVars.pop();
		if (!id) {
			id = { type: 'Identifier', name: `__TEMP_${this.varCounter++}` };
			this.addScopeVar(id);
		}
		this.assign(id, init);
		return id;
	}

	freeTempVar(id: ESTree.Identifier) {
		this.freeVars.push(id);
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

	insertBranchStart(test: ESTree.Expression): GotoResolve {
		const goto = this._createGoto();
		this.statements.push({
			type: 'IfStatement',
			test: this.transformExpr({
				type: 'UnaryExpression',
				operator: '!',
				argument: test
			} as ESTree.UnaryExpression),
			consequent: goto.getForInsertion()
		} as BranchingGotoStatement);
		return goto;
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
		if (this.labelStack.length > 0) {
			throw new Error(`Attempted to leave the context with non-empty label stack: ${this.labelStack.map(label => label.name).join(', ')}`);
		}
		if (this.pendingBreaks.length > 0) {
			throw new Error(`Attempted to leave the context with unresolved break statements: ${this.pendingBreaks.map(label => label.name).join(', ')}`);
		}
		for (const err of this.pendingThrows) {
			/* TS#8377 */ if (err) err.resolve();
		}
		for (const ret of this.pendingReturns) {
			/* TS#8377 */ if (ret) ret.resolve();
		}
		if (this.hadGotos.has(this.statements.length)) {
			this.statements.push({ type: 'EmptyStatement' });
		}
		for (let i = 0; i < this.statements.length; i++) {
			if (this.hadGotos.has(i)) {
				(this.statements[i] as any).leadingComments = [{ type: 'Line', value: ` ${i}:` }];
			}
		}
		if (this.scopeVars.size > 0) {
			const varDecls: ESTree.VariableDeclarator[] = [];
			const varInits: ESTree.ExpressionStatement[] = [];
			for (let varDecl of this.scopeVars.values()) {
				/* TS#8377 */ if (varDecl) {
					if (varDecl.init) {
						varInits.push(this.assign(varDecl.id as ESTree.Identifier, varDecl.init));
						varDecl.init = undefined;
					}
					varDecls.push(varDecl);
				}
			}
			this.statements = [].concat({
				type: 'VariableDeclaration',
				kind: 'var',
				declarations: varDecls
			} as ESTree.VariableDeclaration, varInits, this.statements);
		}
	}

	transformStmt(stmt: ESTree.Statement) {
		if (!(stmt.type in stmtHandlers)) {
			throw new ReferenceError(`Unhandled type ${stmt.type}.`);
		}
		stmtHandlers[stmt.type](this, stmt);
	}
	
	transformExpr(expr: ESTree.Expression) {
		if (!(expr.type in exprHandlers)) {
			throw new ReferenceError(`Unhandled type ${expr.type}.`);
		}
		return exprHandlers[expr.type](this, expr);
	}
}

const stmtHandlers: { [type: string]: (context: Context, item: ESTree.Statement) => void } = {
	Program(context: Context, node: ESTree.Program) {
		node.body.forEach(node => context.transformStmt(node));
	},

	ExpressionStatement(context: Context, node: ESTree.ExpressionStatement) {
		node.expression = context.transformExpr(node.expression);
		context.statements.push(node);
	},

	DebuggerStatement(context: Context, node: ESTree.DebuggerStatement) {
		context.statements.push(node);
	},

	LabeledStatement(context: Context, node: ESTree.LabeledStatement) {
		context.intoBlock(node.label.name, /^((Do)?While|For(In)?)Statement$/.test(node.body.type));
		context.transformStmt(node.body);
		context.leaveBlock();
	},

	BlockStatement(context: Context, node: ESTree.BlockStatement) {
		node.body.forEach(node => context.transformStmt(node));
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
		const start = context.createGotoToHere();
		context.intoBlock('', true);
		context.transformStmt(node.body);
		const rejectBranch = context.insertBranchStart(node.test);
		start.insert();
		rejectBranch.resolve();
		context.leaveBlock();
	},

	ForStatement(context: Context, node: ESTree.ForStatement) {
		if (node.init) {
			let stmt = node.init;
			if (stmt.type !== 'VariableDeclaration') {
				stmt = {
					type: 'ExpressionStatement',
					expression: node.init
				} as ESTree.ExpressionStatement;
			}
			context.transformStmt(stmt);
		}
		const start = context.createGotoToHere();
		const rejectBranch = node.test && context.insertBranchStart(node.test);
		context.intoBlock('', true);
		context.transformStmt(node.body);
		if (node.update) {
			context.transformStmt({
				type: 'ExpressionStatement',
				expression: node.update
			} as ESTree.ExpressionStatement);
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
				const rejectBranch = context.insertBranchStart({
					type: 'BinaryExpression',
					left: localId,
					right: switchCase.test,
					operator: '==='
				} as ESTree.BinaryExpression);
				prevLeave.resolve();
				for (const stmt of switchCase.consequent) {
					/* TS#8377 */ if (stmt) context.transformStmt(stmt);
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
				/* TS#8377 */ if (stmt) context.transformStmt(stmt);
			}
			defaultCase.from.insert();
		}
		prevLeave.resolve();
		context.leaveBlock();
	},

	VariableDeclaration(context: Context, node: ESTree.VariableDeclaration) {
		node.declarations.forEach(decl => {
			const id = decl.id as ESTree.Identifier;
			context.addScopeVar(decl.id as ESTree.Identifier);
			if (decl.init) {
				context.assign(id, decl.init);
			}
		});
	},

	FunctionDeclaration(context: Context, node: ESTree.FunctionDeclaration) {
		context.addScopeVar(node.id).init = context.transformExpr(Object.assign(node, {
			type: 'FunctionExpression' as 'FunctionExpression'
		}) as ESTree.FunctionExpression);
	},

	ThrowStatement(context: Context, node: ESTree.ThrowStatement) {
		context.assign(Context.__ERROR, node.argument);
		context.pendingThrows.push(context.insertPendingGoto());
	},

	TryStatement(context: Context, node: ESTree.TryStatement) {
		context.transformStmt(node.block);
		if (node.handler && context.pendingThrows.length > 0) {
			const allGood = context.insertPendingGoto();

			context.pendingThrows.forEach(goto => {
				goto.resolve();
			});

			context.pendingThrows = [];

			const outerVar = context.shadowVar(node.handler.param as ESTree.Identifier, Context.__ERROR);
			context.assign(Context.__ERROR, Context.UNDEF);

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

const exprHandlers: { [type: string]: (context: Context, item: ESTree.Expression) => ESTree.Identifier | ESTree.Literal | ESTree.FunctionExpression | SimplifiedAssignmentExpression } = {
	Literal(_: Context, node: ESTree.Literal): ESTree.Literal {
		return node;
	},

	Identifier(_: Context, node: ESTree.Identifier): ESTree.Identifier {
		return node;
	},

	FunctionExpression(_: Context, node: ESTree.FunctionExpression): ESTree.FunctionExpression {
		const context = new Context(true);
		context.addScopeVar(Context.__RESULT);
		context.transformStmt(node.body);
		(node.body as ESTree.BlockStatement).body = context.statements;
		context.leave();
		return node;
	},
	
	AssignmentExpression(_: Context, node: ESTree.AssignmentExpression): SimplifiedAssignmentExpression {
		return node;
	},
	
	UnaryExpression(_: Context, node: ESTree.UnaryExpression): ESTree.UnaryExpression {
		return node;
	},
	
	CallExpression(_: Context, node: ESTree.CallExpression): ESTree.CallExpression {
		return node;
	}
};

{
	const ast = parse(readFileSync('test.js', 'utf-8'), { locations: true });

	const context = new Context(false);
	context.transformStmt(ast);
	context.leave();

	writeFileSync('test.out.js', generate({
		type: 'Program',
		sourceType: ast.sourceType,
		body: context.statements
	} as ESTree.Program, { comment: true }));
}