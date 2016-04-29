declare module 'escodegen' {
	function generate(ast: ESTree.Node, options?: any): string;
}