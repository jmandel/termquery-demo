const processors = {
	EntireExpression,
	TermExpression,
	InvocationExpression,
	FunctionInvocation,
	Functn,
	ParamList,
	MemberInvocation,
	UnionExpression
};

function processFP(e, context = { baseRow: null, nextRow: 0, stack: [], lines: [] }) {
	let ret = processors[e.type](e, context);
	return ret;
}

function InvocationExpression(e, context) {
	if (e.children.length !== 2) {
		throw 'Expected InvocationExpression to have exactly two children';
	}
	const withOne = processFP(e.children[0], context);
	const withTwo = processFP(e.children[1], withOne);
	return withTwo;
}

function FunctionInvocation(e, context) {
	if (e.children.length !== 1) {
		throw 'Expected FunctionInvocation to have exactly one child';
	}
	return processFP(e.children[0], context);
}

function colHelpers(context) {
	let contextCols = context.stack && context.stack[0] ? context.stack[0].cols : 0;
	let contextColsString = !contextCols
		? ''
		: new Array(contextCols)
				.fill(0)
				.map((_, c) => `col${c}`)
				.join(', ') + ',';
	let outputCol = contextCols;
	let outputColString = `col${outputCol}`;

	return { contextCols, contextColsString, outputCol, outputColString };
}

// TODO rewrite to use the Functn implementation?
function UnionExpression(e, context) {
	let cnext = {
		...context,
		term: undefined
	};

	let accumulated = [];
	for (let i = 0; i < e.children.length; i++) {
		let contextAfter = processFP(e.children[i], cnext);
		cnext.nextRow = contextAfter.nextRow;
		accumulated.push(contextAfter);
	}
	let cFinal = {
		...context,
		nextRow: cnext.nextRow,
		lines: [...context.lines, ...accumulated.flatMap((a) => a.lines.slice(context.lines.length))]
	};

	cFinal.lines.push(
		`line${cFinal.nextRow} as (
          ${accumulated.map((a) => `SELECT * from line${a.nextRow - 1}`).join(' UNION ')}
        )`
	);
	cFinal.baseRow++;
	cFinal.nextRow++;
	return cFinal;
}

function Functn(e, context) {
	if (e.children.length !== 2) {
		throw 'Expected InvocationExpression to have exactly two children';
	}

	if (e.children[0].type !== 'Identifier') {
		throw 'Only Identifier invocation is supported for Functn' + JSON.stringify(e, null, 2);
	}

	let fn = e.children[0].text;
	let cnext = {
		...context,
		term: undefined,
		firstClauseInStack: true,
		stack: [
			{
				cols: context.stack.length + 1,
				baseRowAtStackStart: context.baseRow,
				fn
			},
			...context.stack
		]
	};

	if (fn === 'union') {
		if (context.stack.length) {
			cnext.baseRow = context.stack[0].baseRowAtStackStart;
			cnext.stack = cnext.stack.slice(1);
		}
	}

	let fnArgs = processFP(e.children[1], cnext);
	let { contextCols, contextColsString, outputCol } = colHelpers(fnArgs);
	if (fn === 'matches') {
		fnArgs.lines.push(
			`line${fnArgs.nextRow} as (select ${contextColsString.slice(0, -1)} from line${fnArgs.baseRow} join json_each(col${
				outputCol - 1
			}) je where je.value LIKE col${outputCol})`
		);
		fnArgs.baseRow++;
		fnArgs.nextRow++;
	}

	if (fn === 'select') {
	}

	if (fn === 'union') {
		fnArgs.lines.push(`line${fnArgs.nextRow} as (
        select * from line${context.nextRow - 1} UNION select * from line${fnArgs.nextRow - 1}
)`);
		fnArgs.nextRow++;
		fnArgs.baseRow = fnArgs.nextRow - 1;
	}

	return {
		...fnArgs,
		stack: context.stack
	};
}

function ParamList(e, context) {
	if (e.children.length !== 1) {
		throw 'expected param list to have 1 child';
	}
	return processFP(e.children[0], context);
}

function EntireExpression(e, context) {
	if (e.children.length !== 1) {
		throw 'Expected EntireExpression to have exactly one child';
	}
	return processFP(e.children[0], context);
}

function TermExpression(e, context) {
	let term = e.children[0].text;
	let { contextCols, contextColsString, outputCol, outputColString } = colHelpers(context);

	const isLiteral = term.startsWith("'");

	const relHelper = { inRels: false };

	const lines = [];
	if (term === 'Concept') {
		let cols = 'col0';
		lines.push(`select concept as ${cols} from concepts`);
	} else if (isLiteral) {
		let literalString = term.match(/^'(.*)'$/)[1];
		lines.push(
			`select ${contextColsString} '${literalString}' as ${outputColString} from line${context.baseRow}`
		);
	} else {
		if (term == '$this') {
			term = '$';
		}
		lines.push(
			`select ${contextColsString} col${
				context.firstClauseInStack ? outputCol - 1 : outputCol
			}->'${term}'  as ${outputColString} from line${context.baseRow}`
		);
		if (context.inRels) {
			lines.push(
				`select rj.concept as col${outputCol - 1}, rj.concept as ${outputColString} from line${
					context.baseRow + 1
				} join json_each(${outputColString}) cui2 join concepts rj where rj.concept->>'cui'=cui2.value`
			);
		}
		if (term === 'rels') {
			relHelper.inRels = true;
		}
	}

	let cnext = {
		...context,
		...relHelper,
		firstClauseInStack: undefined,
		nextRow: context.nextRow + lines.length,
		baseRow: context.nextRow + lines.length - 1,
		lines: [...context.lines, ...lines.map((l, i) => `line${context.nextRow + i} as (${l})`)]
	};

	return cnext;
}

function MemberInvocation(e, context) {
	return TermExpression(e, context);
}

export default function toSql(parsed) {
	let execution = processFP(parsed.children[0]);
	let lines = execution.lines;
	let ret = '';
	ret += 'WITH\n';
	ret += lines.join(', \n');
	ret += `\nselect * from line${lines.length - 1};`;
	return ret;
}
