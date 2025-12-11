/**
 * Functions for checking for problems in the function planner diagram.
 * 
 * Exports:
 *  - setupProblemChecking(diagram)
 *  - updateAllProblems(diagram)
 *  - modelProblems(diagram)
 *  - willFuncBecomeRecursive(diagram, from, to)
 *  - linkProblems(link)
 *  - funcLinkProblems(node)
 *  - funcIOProblemsUpdateParents(node, visited=new Set())
 *  - funcProblems(data, diagram, fix=false)
 *  - checkName(name, type="Function", field="name")
 *  - isFunctionNameNotUnique(data, diagram)
  */

import go from 'gojs';

import { deepEquals } from './utils.js';
import { INFO_BOX_CLASS_NAME, MAIN_CHECK_CLASS_NAME, NUM_COUNT_CLASS_NAME, NUM_TESTABLE_CLASS_NAME } from './buttons.js';

/**
 * Sets up problem checking listeners on the diagram to automatically update
 * problems when the diagram is modified.
 * @param {*} diagram 
 */
export function setupProblemChecking(diagram) {
    updateAllProblems(diagram);
    function updateNodeLinkProblems(node) {
        diagram.model.setDataProperty(node.data, 'linkProblems', funcLinkProblems(node));
    }
    function updateLinkProblems(e) {
        const link = e.subject;
        funcIOProblemsUpdateParents(link.fromNode);
        updateNodeLinkProblems(link.fromNode);
        updateNodeLinkProblems(link.toNode);
        diagram.model.setDataProperty(link.data, 'linkProblems', linkProblems(link));
        if (e.parameter && e.parameter.part) {
            funcIOProblemsUpdateParents(e.parameter.part);
            updateNodeLinkProblems(e.parameter.part);
        }
        modelLinkProblems(diagram);
    }
    diagram.addDiagramListener('LinkDrawn', updateLinkProblems);
    diagram.addDiagramListener('LinkRelinked', updateLinkProblems);
    diagram.addDiagramListener('SelectionDeleted', (e) => {
        const parts = e.subject;
        for (const part of parts) {
            if (part instanceof go.Node) {
                modelProblems(diagram);
            } else if (part instanceof go.Link) {
                // removing a link
                if (part.fromNode && !parts.has(part.fromNode)) {
                    funcIOProblemsUpdateParents(part.fromNode);
                    updateNodeLinkProblems(part.fromNode);
                }
                if (part.toNode && part.toNode !== part.fromNode && !parts.has(part.toNode)) {
                    updateNodeLinkProblems(part.toNode);
                }
                modelLinkProblems(diagram);
            }
        }
    });
    diagram.addModelChangedListener((e) => {
        if (e.change === go.ChangedEvent.Insert && e.propertyName === 'nodeDataArray') {
            // node added
            const nodeData = e.newValue;
            diagram.model.setDataProperty(nodeData, 'problems', funcProblems(nodeData, diagram));
            diagram.model.setDataProperty(nodeData, 'linkProblems', funcLinkProblems(diagram.findNodeForData(nodeData)));
            modelProblems(diagram);
        } else if (e.change === go.ChangedEvent.Remove && e.propertyName === 'nodeDataArray') {
            // node removed
            modelProblems(diagram);
        }
    });
}

/**
 * Updates all of the problems, including model, function, and link problems.
 * @param {*} diagram 
 */
export function updateAllProblems(diagram) {
    const model = diagram.model;
    for (const node of diagram.nodes) {
        const data = node.data;
        model.setDataProperty(data, 'problems', funcProblems(data, diagram));
        model.setDataProperty(data, 'linkProblems', funcLinkProblems(node));
        for (const link of node.findLinksConnected()) {
            model.setDataProperty(link.data, 'linkProblems', linkProblems(link));
        }
    }
    model.setDataProperty(model.modelData, 'problems', modelProblems(diagram));
    modelLinkProblems(diagram); // updates problems directly
}

/**
 * Checks the diagram model for problems about the overall model (not individual functions/links):
 *  - presence of main function
 *  - module documentation
 *  - author names
 *  - minimum number of functions
 *  - minimum number of testable functions
 * @param {*} diagram 
 * @returns array of problems found: [ [severity, field, message], ... ]
 */
export function modelProblems(diagram) {
    const infoBox = diagram.div.parentNode.getElementsByClassName(INFO_BOX_CLASS_NAME)[0];
    const countRow = infoBox.getElementsByClassName(NUM_COUNT_CLASS_NAME)[0];
    const testableRow = infoBox.getElementsByClassName(NUM_TESTABLE_CLASS_NAME)[0];
    const minFunctions = diagram.minFunctions ?? 1;
    const minTestable = diagram.minTestable ?? 0;

    const model = diagram.model;
    const data = model.modelData;
    const nodes = model.nodeDataArray;
    const problems = [];

    // Check for main function
    const hasMain = nodes.some(n => n.name === 'main');
    infoBox.getElementsByClassName(MAIN_CHECK_CLASS_NAME)[0].classList.toggle('value-hidden', hasMain);
    if (!hasMain) { problems.push(["error", "main", "There must be a main() function."]); }

    // Check for module documentation
    if (!diagram.callGraphOnly) {
        const docLen = (data.documentation || '').trim().length;
        if (docLen === 0) {
            problems.push(["error", "documentation", "Module documentation is missing."]);
        } else if (docLen < (diagram.minModuleDescLength ?? 25)) {
            problems.push(["warning", "documentation", "Module documentation is too short."]);
        }
    }

    // Check for author names
    if (!diagram.callGraphOnly) {
        const authorsLength = (data.authors || '').trim().length;
        if (authorsLength === 0) {
            problems.push(["error", "authors", "Author name(s) are required."]);
        } else if (authorsLength < 3) {
            problems.push(["warning", "authors", "Author name(s) seem too short."]);
        }
    }

    // Check that there are a minimum number of functions in total
    countRow.cells[1].textContent = nodes.length;
    countRow.classList.toggle('value-error', nodes.length < minFunctions);
    if (nodes.length < minFunctions) { problems.push(["error", "functions", `There must be at least ${minFunctions} functions.`]); }

    // Check that there are a minimum number of testable functions
    const nTestable = nodes.filter(n => n.testable).length;
    testableRow.cells[1].textContent = nTestable;
    testableRow.classList.toggle('value-error', nTestable < minTestable);
    if (nTestable < minTestable) { problems.push(["error", "testable", `There must be at least ${minTestable} testable functions.`]); }

    return problems;
}

/**
 * Updates model-wide link problems in the call graph. Mostly checks for cycles.
 * @param {*} diagram 
 * @param {*} startingKey 
 */
function modelLinkProblems(diagram, startingKey = null) {
    const model = diagram.model;
    const cycles = findCycles(diagram, startingKey).filter(cycle => cycle.length > 1); // only cycles with more than one node (self-recursive functions are already handled)
    const map = cyclesToMap(cycles);
    for (const link of model.linkDataArray) {
        const lp = link.linkProblems || [];
        const currentlyHasCycle = lp.some(p => p[2].includes('cycle'));
        if (map.has(link.from) && map.get(link.from).includes(link.to)) {
            if (!currentlyHasCycle) { model.setDataProperty(link, 'linkProblems', lp.concat([["warning", "link", 'Part of a recursive cycle. Recursive functions are tricky, be careful if this is what you intended.']])); }
        } else if (currentlyHasCycle) { model.setDataProperty(link, 'linkProblems', lp.filter(p => !p[2].includes('cycle'))); }
    }
    for (const node of model.nodeDataArray) {
        const lp = node.linkProblems || [];
        const currentlyHasCycle = lp.some(p => p[2].includes('cycle'));
        if (map.has(node.key)) {
            if (!currentlyHasCycle) { model.setDataProperty(node, 'linkProblems', lp.concat([["warning", "callsInto", 'Part of a recursive cycle. Recursive functions are tricky, be careful if this is what you intended.']])); }
        } else if (currentlyHasCycle) { model.setDataProperty(node, 'linkProblems', lp.filter(p => !p[2].includes('cycle'))); }
    }
}
function findCycles(diagram, startingKey = null) {
    const model = diagram.model;
    const nodes = model.nodeDataArray;
    const links = model.linkDataArray;
    let cycles = [];

    // Check that there are no cycles in the function calls
    // This can produce a few duplicates, but things would have to be very convoluted for that to happen
    const callGraph = linksToMap(links);
    const keys = new Set(nodes.map(n => n.key));
    const stack = [];
    const dfs = function(key) {
        if (!keys.has(key)) { return; }
        keys.delete(key);
        stack.push(key);
        for (const to of callGraph[key] || []) {
            if (stack.includes(to)) { cycles.push(stack.slice(stack.lastIndexOf(to))); } else { dfs(to); }
        }
        stack.pop();
    }
    if (startingKey) {
        // only cycles starting from a specific function
        dfs(startingKey);
        // it can find cycles starting from other functions so we filter them out
        cycles = cycles.filter(cycle => cycle.includes(startingKey));
    } else { while (keys.size > 0) { dfs(keys.values().next().value); } } // all cycles

    return cycles;
}
function linksToMap(links) {
    const map = {};
    for (const link of links) {
        if (!map[link.from]) { map[link.from] = []; }
        map[link.from].push(link.to);
    }
    return map;
}
function cyclesToMap(cycles) {
    const links = new Map();
    for (const cycle of cycles) {
        for (let i = 0; i < cycle.length; i++) {
            const from = cycle[i];
            const to = cycle[(i + 1) % cycle.length];
            if (!links.has(from)) { links.set(from, []); }
            links.get(from).push(to);
        }
    }
    return links;
}

/**
 * Checks if the given function will become part of a cycle in the call graph.
 * @param {*} diagram 
 * @param {go.Node} from the source node of a new link
 * @param {go.Node} to the destination node of a new link
 * @returns {boolean} True if the function will become part of a cycle by adding the link.
 */
export function willFuncBecomeRecursive(diagram, from, to) {
    if (from === to) { return true; }
    const fromKey = from.data.key;
    const model = diagram.model;
    const callGraph = linksToMap(model.linkDataArray);
    if (!callGraph[fromKey]) { callGraph[fromKey] = []; }
    callGraph[fromKey].push(to.data.key);
    const visited = new Set();
    const stack = [];
    const dfs = function(key) {
        visited.add(key);
        stack.push(key);
        for (const next of callGraph[key] || []) {
            if (next === fromKey || !stack.includes(next) && dfs(next)) { return true; }
        }
        stack.pop();
        return false;
    }
    return dfs(to.data.key);
}

/**
 * Checks for problems with a specific link. Does not check for long recursive cycles (that is done
 * in modelLinkProblems).
 * @param {go.Link} link 
 * @returns array of problems found: [ [severity, field, message], ... ]
 */
export function linkProblems(link) {
    const data = link.data;
    const problems = [];
    if (link.toNode.data.name === 'main') { problems.push(["error", "link", "Main function should not be called by other functions."]); }
    else if (link.toNode === link.fromNode) { problems.push(["warning", "link", "Recursive functions are tricky, be careful if this is what you intended."]); }
    return problems;
}
/**
 * Checks for problems with the links of a specific function.
 * @param {go.Node} node 
 * @returns array of problems found: [ [severity, field, message], ... ]
 */
export function funcLinkProblems(node) {
    const data = node.data;
    const problems = [];

    const isMain = data.name === 'main';
    const nodesInto = Array.from(node.findNodesInto());
    const nodesOutOf = Array.from(node.findNodesOutOf());
    if (isMain) {
        if (nodesInto.length !== 0) { problems.push(["error", "callsInto", "Main function should not be called by other functions."]); }
        if (nodesOutOf.length === 0) { problems.push(["warning", "callsOutOf", "Main function should call at least one other function."]); }
    } else {
        if (nodesInto.length === 0) { problems.push(["error", "callsInto", "Non-main functions must be called by at least one other function."]); }
        else if (nodesInto.includes(node)) { problems.push(["warning", "callsInto", "Recursive functions are tricky, be careful if this is what you intended."]); }
    }

    return problems;
}

function funcIOProblems(node) {
    const data = node.data;
    const problems = [];
    const io = data.io || 'none';
    if (data.name === 'main') {
        if (!['none', 'indirect'].includes(io)) { problems.push(["warning", "io", "Main function should not have any direct user input or output."]); }
    }
    if (data.testable && io !== 'none') { problems.push(["error", "testable,io", "We cannot test functions that have direct or indirect user input or output."]); }
    if (io === 'indirect' || io === 'none') {
        const hasChildIO = treeHasIO(node);
        if (io === 'indirect') {
            if (!hasChildIO) { problems.push(["error", "io", "Function is marked as having indirect user I/O but no function it calls has user input/output."]); }
        } else if (hasChildIO) { problems.push(["error", "io", "Function is marked as having no user input/output but calls another function with user input/output; it should be marked as 'indirect'."]); }
    }
    return problems;
}
function treeHasIO(node, checked = new Set()) {
    if (checked.has(node.key)) return false; // avoid infinite recursion
    checked.add(node.key);
    if (['validation', 'input', 'output'].includes(node.data.io)) return true;
    return Array.from(node.findNodesOutOf()).some(child => treeHasIO(child, checked));
}
function funcIOProblemsUpdate(node) {
    const curProblems = node.data.problems;
    const ioProblems = funcIOProblems(node);
    const newProblems = curProblems.filter(p => !p[1].split(',').includes('io')).concat(ioProblems);
    if (!deepEquals(curProblems, newProblems)) { node.diagram.model.setDataProperty(node.data, 'problems', newProblems); }
}
/**
 * Updates the I/O problems for the given node and all of its parent nodes. Updates the problems
 * attribute of each node as needed.
 * @param {go.Node} node 
 * @param {Set<number>} visited - do not provide, used to avoid infinite recursion
 */
export function funcIOProblemsUpdateParents(node, visited = new Set()) {
    if (node.diagram.callGraphOnly) return; // no I/O problem checking
    if (visited.has(node.key)) return; // avoid infinite recursion
    visited.add(node.key);
    funcIOProblemsUpdate(node);
    for (const parent of node.findNodesInto()) {
        funcIOProblemsUpdateParents(parent, visited);
    }
}

const PYTHON_KEYWORDS = new Set([
    'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
    'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
    'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass',
    'raise', 'return', 'try', 'while', 'with', 'yield'
]);
const PYTHON_BUILTINS = new Set([
    'abs', 'all', 'any', 'ascii', 'bin', 'bool', 'bytearray', 'bytes',
    'callable', 'chr', 'classmethod', 'compile', 'complex', 'delattr', 'dict',
    'dir', 'divmod', 'enumerate', 'eval', 'exec', 'filter', 'float', 'format',
    'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'help', 'hex', 'id',
    'input', 'int', 'isinstance', 'issubclass', 'iter', 'len', 'list', 'locals',
    'map', 'max', 'memoryview', 'min', 'next', 'object', 'oct', 'open', 'ord',
    'pow', 'print', 'property', 'range', 'repr', 'reversed', 'round', 'set',
    'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super',
    'tuple', 'type', 'vars', 'zip'
]);
/**
 * Checks for problems with a specific name.
 * @param {string} name the name to check
 * @param {string} type 
 * @param {string} field 
 * @returns [severity, field, message] if a problem is found, null otherwise
 */
export function checkName(name, type="Function", field="name") {
    if (!name) { return ["error", field, `${type} name is required.`]; }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) { return ["error", field, `${type} name must start with a letter or underscore and contain only letters, numbers, and underscores.`]; }
    if (PYTHON_KEYWORDS.has(name)) { return ["error", field, `${type} name cannot be a Python keyword.`]; }
    if (PYTHON_BUILTINS.has(name)) { return ["error", field, `${type} name cannot be a Python built-in function or type.`]; }
    if (name.startsWith('_') || name.endsWith('_')) { return ["warning", field, `${type} name should not start or end with an underscore.`]; }
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) { return ["warning", field, `${type} names should be in lowercase with underscores separating words.`]; }
    return null;
}

/**
 * Checks if a function name is not unique within the diagram.
 * @param {string} name 
 * @param {*} diagram 
 * @param {boolean} changedInData - If true, assumes the name has already been changed in the data.
 * @returns {boolean} True if the function name is not unique, false otherwise
 */
export function isFunctionNameNotUnique(name, diagram, changedInData=true) {
    if (!name || !diagram) { return false; }
    return diagram.findNodesByExample({ name }).count > (changedInData ? 1 : 0);
}

/**
 * Checks for problems with a specific function.
 * @param {*} data 
 * @param {*} diagram 
 * @param {boolean} fix - If true, attempts to fix problems where possible
 * @returns array of problems found: [ [severity, field, message], ... ]
 */
export function funcProblems(data, diagram, fix=false) {
    const problems = [];

    const nameProblem = checkName(data.name, "Function", "name");
    if (nameProblem) { problems.push(nameProblem); }
    if (isFunctionNameNotUnique(data.name, diagram)) { problems.push(["error", "name", "Function name must be unique."]); }
    if (diagram && diagram.callGraphOnly) { return problems; }

    const isMain = data.name === 'main';
    const desc = (data.desc || '').trim();
    const params = data.params || [];
    const returns = data.returns || [];
    const io = data.io || 'none';
    const testable = data.testable || false;
    if (isMain) {
        if (fix) {
            data.desc = '';
            data.params = [];
            data.returns = [];
        } else {
            if (desc.length > 0) { problems.push(["warning", "desc", "Main function does not need a description."]); }
            if (params.length > 0) { problems.push(["error", "params", "Main function should not have parameters."]); }
            if (returns.length > 0) { problems.push(["error", "returns", "Main function should not return values."]); }
        }
    } else {
        if (desc.length === 0) { problems.push(["warning", "desc", "Function description is required."]); }
        else if (desc.length < (diagram.minFuncDescLength ?? 20)) { problems.push(["warning", "desc", "Function description is too short - be more descriptive!"]); }
        // if (params.length === 0 && returns.length === 0 && io !== 'output') {
        //     problems.push(["error", "params,returns", "Non-main functions should have at least one parameter or return value, or be output only."]);
        // }
        const names = [];
        for (let i = 0; i < params.length; i++) {
            const param = params[i];
            const problem = checkName(param.name, "Parameter", `params[${i}].name`);
            if (problem) { problems.push(problem); }
            if (names.includes(param.name)) {
                const index = names.indexOf(param.name);
                problems.push(["error", `params[${index}].name`, "Parameter name must be unique within a function."]);
                problems.push(["error", `params[${i}].name`, "Parameter name must be unique within a function."]);
            }
            names.push(param.name);
            if (!param.type) { problems.push(["error", `params[${i}].type`, "Parameter type is required."]); }
            if (!param.desc) { problems.push(["error", `params[${i}].desc`, "Parameter description is required."]); }
            else if (param.desc.length < (diagram.minParamDescLength ?? 20)) { problems.push(["warning", `params[${i}].desc`, "Parameter description is too short - be more descriptive!"]); }
        }
        for (let i = 0; i < returns.length; i++) {
            const ret = returns[i];
            if (!ret.type) { problems.push(["error", `returns[${i}].type`, "Return value type is required."]); }
            if (!ret.desc) { problems.push(["error", `returns[${i}].desc`, "Return value description is required."]); }
            else if (ret.desc.length < (diagram.minReturnDescLength ?? 20)) { problems.push(["warning", `returns[${i}].desc`, "Return value description is too short - be more descriptive!"]); }
        }
    }

    if (testable && params.length === 0) { problems.push(["warning", "testable,params", "Testable functions should have at least one parameter."]); }
    if (testable && returns.length === 0) { problems.push(["warning", "testable,returns", "Testable functions should have at least one return value."]); }
    if (diagram) { problems.push(...funcIOProblems(diagram.findNodeForData(data))); }
    return problems;
}
