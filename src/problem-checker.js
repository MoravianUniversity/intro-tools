/**
 * Functions for checking for problems in the function planner model.
 * 
 * Exports:
 *  - setupProblemChecking(model, options)
 *  - updateAllProblems(model, options={})
 *  - willFuncBecomeRecursive(model, from, to)
 *  - checkName(name, type="Function", field="name")
 *  - isFunctionNameNotUnique(model, key, name)
  */

import { deepEquals, dup } from './utils.js';

/**
 * Sets up problem checking listeners on the model to automatically update
 * problems when the model is modified.
 * @param {*} model
 * @param {object} options
 */
export function setupProblemChecking(model, options) {
    updateAllProblems(model, options);
    function updateNodeLinkProblems(key) {
        model.setFuncLinkProblems(key, funcLinkProblems(model, key));
    }
    function updateLinkProblems(oldFrom, oldTo, newFrom, newTo) {
        funcIOProblemsUpdateParents(model, newFrom, options);
        if ((oldFrom ?? newFrom) !== newFrom) { funcIOProblemsUpdateParents(model, oldFrom, options); }
        updateNodeLinkProblems(newFrom);
        updateNodeLinkProblems(newTo);
        if ((oldFrom ?? newFrom) !== newFrom) { updateNodeLinkProblems(oldFrom); }
        if ((oldTo ?? newTo) !== newTo) { updateNodeLinkProblems(oldTo); }
        model.setFuncCallProblems(newFrom, newTo, linkProblems(model, newFrom, newTo));
        modelLinkProblems(model);
    }

    model.addFuncAddListener((key, data) => {
        model.setFuncProblems(key, funcProblems(model, key, options, true));
        model.setFuncLinkProblems(key, funcLinkProblems(model, key));
    });
    model.addFuncListener('', (key, property, newValue) => {
        if (property === 'problems' || property === 'linkProblems') { return; } // don't trigger on our own changes
        model.setFuncProblems(key, funcProblems(model, key, options, false));
        if (property === 'name') { // recheck the link problems since "main" is special and check for non-unique names
            model.setFuncLinkProblems(key, funcLinkProblems(model, key));
            for (const toKey of model.calledFunctions[key] || []) {
                model.setFuncCallProblems(key, toKey, linkProblems(model, key, toKey));
            }
            for (const fromKey of model.callingFunctions[key] || []) {
                model.setFuncCallProblems(fromKey, key, linkProblems(model, fromKey, key));
            }
            const name = (newValue || '').toString().trim();
            const functions = Array.from(model.functions);
            functions.filter(kf => kf[0] !== key && kf[1].get('name')?.toString()?.trim() === name).forEach(
                kf => { model.setFuncProblems(kf[0], funcProblems(model, kf[0], options, false)); }
            );
            modelLinkProblems(model);
        } else if (property === 'io') {  // recheck the parent's io problems due to indirect/none
            funcIOProblemsUpdateParents(model, key, options);
        }
    });
    model.addFuncCallListener((action, oldFrom, oldTo, newFrom, newTo) => {
        if (action === 'problems') { return; } // don't trigger on our own changes
        if (action === 'add' || action === 'update') {
            updateLinkProblems(oldFrom, oldTo, newFrom, newTo);
        } else if (action === 'delete') {
            if (oldFrom && model.functions.has(oldFrom)) {
                funcIOProblemsUpdateParents(model, oldFrom, options);
                updateNodeLinkProblems(oldFrom);
            }
            if (oldTo && oldTo !== oldFrom && model.functions.has(oldTo)) {
                updateNodeLinkProblems(oldTo);
            }
            modelLinkProblems(model);
        }
    });

    if (!options.callGraphOnly) {
        model.addModelDataListener('documentation', () => { checkModuleDocumentation(model, options); });
        model.addModelDataListener('authors', () => { checkModuleAuthors(model, options); });
        checkModuleDocumentation(model, options);
        checkModuleAuthors(model, options);
    }
}

/**
 * Updates all of the problems, including model, function, and link problems.
 * @param {*} model
 * @param {object} options
 */
export function updateAllProblems(model, options={}) {
    for (const key of model.functions.keys()) {
        model.setFuncProblems(key, funcProblems(model, key, options));
        model.setFuncLinkProblems(key, funcLinkProblems(model, key));
        for (const toKey of model.calledFunctions[key] || []) {
            model.setFuncCallProblems(key, toKey, linkProblems(model, key, toKey));
        }
    }
    // the rest update problems directly
    if (!options.callGraphOnly) { checkModuleDocumentation(model, options); checkModuleAuthors(model, options); }
    modelLinkProblems(model);
}

function checkModuleDocumentation(model, options={}) {
    const docLen = (model.modelData.get('documentation')?.toString() || '').trim().length;
    model.clearModelDataProblem(null, "documentation");
    if (docLen === 0) {
        model.recordModelDataProblem("error", "documentation", "Module documentation is missing.");
    } else if (docLen < (options.minModuleDescLength ?? 25)) {
        model.recordModelDataProblem("warning", "documentation", "Module documentation is too short.");
    }
}

function checkModuleAuthors(model, options={}) {
    const authorsLength = (model.modelData.get('authors')?.toString() || '').trim().length;
    model.clearModelDataProblem(null, "authors");
    if (authorsLength === 0) {
        model.recordModelDataProblem("error", "authors", "Author name(s) are required.");
    } else if (authorsLength < 3) {
        model.recordModelDataProblem("warning", "authors", "Author name(s) seem too short.");
    }
}

/**
 * Updates model-wide link problems in the call graph. Mostly checks for cycles.
 * @param {*} model 
 * @param {*} startingKey 
 */
function modelLinkProblems(model, startingKey = null) {
    const cycles = findCycles(model, startingKey).filter(cycle => cycle.length > 1); // only cycles with more than one node (self-recursive functions are already handled)
    const map = cyclesToMap(cycles);
    for (const callKey of model.calls.keys()) {
        const [from, to] = callKey.split('-');
        const lp = model.getFuncCallProblems(from, to);
        const currentlyHasCycle = lp.some(p => p[2].includes('cycle'));
        if (map.has(from) && map.get(from).includes(to)) {
            if (!currentlyHasCycle) { model.setFuncCallProblems(from, to, lp.concat([["warning", "link", 'Part of a recursive cycle. Recursive functions are tricky, be careful if this is what you intended.']])); }
        } else if (currentlyHasCycle) { model.setFuncCallProblems(from, to, lp.filter(p => !p[2].includes('cycle'))); }
    }
    for (const [key, func] of model.functions) {
        const lp = model.getFuncLinkProblems(key);
        const currentlyHasCycle = lp.some(p => p[2].includes('cycle'));
        if (map.has(key)) {
            if (!currentlyHasCycle) { model.setFuncLinkProblems(key, lp.concat([["warning", "callsInto", 'Part of a recursive cycle. Recursive functions are tricky, be careful if this is what you intended.']])); }
        } else if (currentlyHasCycle) { model.setFuncLinkProblems(key, lp.filter(p => !p[2].includes('cycle'))); }
    }
}
function findCycles(model, startingKey = null) {
    let cycles = [];

    // Check that there are no cycles in the function calls
    // This can produce a few duplicates, but things would have to be very convoluted for that to happen
    const callGraph = dup(model.calledFunctions);
    const keys = new Set(model.functions.keys());
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
 * @param {*} model 
 * @param {string} fromKey the source of a new link
 * @param {string} toKey the destination of a new link
 * @returns {boolean} True if the function will become part of a cycle by adding the link.
 */
export function willFuncBecomeRecursive(model, fromKey, toKey) {
    if (fromKey === toKey) { return true; }
    const callGraph = dup(model.calledFunctions);
    if (!callGraph[fromKey]) { callGraph[fromKey] = []; }
    callGraph[fromKey].push(toKey);
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
    return dfs(toKey);
}

/**
 * Checks for problems with a specific link. Does not check for long recursive cycles (that is done
 * in modelLinkProblems).
 * @param {*} model
 * @param {string} fromKey - the key of the source function of a link
 * @param {string} toKey - the key of the destination function of a link
 * @returns array of problems found: [ [severity, field, message], ... ]
 */
function linkProblems(model, fromKey, toKey) {
    const problems = [];
    const to = model.functions.get(toKey);
    if (to.get("name")?.toString()?.trim() === 'main') { problems.push(["error", "link", "Main function should not be called by other functions."]); }
    else if (toKey === fromKey) { problems.push(["warning", "link", "Recursive functions are tricky, be careful if this is what you intended."]); }
    return problems;
}
/**
 * Checks for problems with the links of a specific function.
 * @param {*} model
 * @param {string} key
 * @returns array of problems found: [ [severity, field, message], ... ]
 */
function funcLinkProblems(model, key) {
    const problems = [];
    // sometimes we can get called in the middle of an update, so we check if the function still exists just to be safe
    const isMain = model.functions.get(key)?.get("name")?.toString()?.trim() === 'main';
    const callsInto = model.callingFunctions[key] || [];
    const callsOutOf = model.calledFunctions[key] || [];
    if (isMain) {
        if (callsInto.length !== 0) { problems.push(["error", "callsInto", "Main function should not be called by other functions."]); }
        if (callsOutOf.length === 0) { problems.push(["warning", "callsOutOf", "Main function should call at least one other function."]); }
    } else {
        if (callsInto.length === 0) { problems.push(["error", "callsInto", "Non-main functions must be called by at least one other function."]); }
        else if (callsInto.includes(key)) { problems.push(["warning", "callsInto", "Recursive functions are tricky, be careful if this is what you intended."]); }
    }

    return problems;
}

function funcIOProblems(model, key, func) { // func must be a JSON object
    const problems = [];
    const io = func.io || 'none';
    if (func.name?.trim() === 'main') {
        if (!['none', 'indirect'].includes(io)) { problems.push(["warning", "io", "Main function should not have any direct user input or output."]); }
    }
    if (func.testable && io !== 'none') { problems.push(["error", "testable,io", "We cannot test functions that have direct or indirect user input or output."]); }
    if (io === 'indirect' || io === 'none') {
        const hasChildIO = treeHasIO(model, key);
        if (io === 'indirect') {
            if (!hasChildIO) { problems.push(["error", "io", "Function is marked as having indirect user I/O but no function it calls has user input/output."]); }
        } else if (hasChildIO) { problems.push(["error", "io", "Function is marked as having no user input/output but calls another function with user input/output; it should be marked as 'indirect'."]); }
    }
    return problems;
}
function treeHasIO(model, key, checked = new Set()) {
    if (checked.has(key)) { return false; } // avoid infinite recursion
    checked.add(key);
    const io = model.functions.get(key)?.get("io");
    if (io && ['validation', 'input', 'output'].includes(io)) { return true; }
    return Array.from(model.calledFunctions[key] || []).some(child => treeHasIO(model, child, checked));
}
function funcIOProblemsUpdate(model, key) {
    const func = model.functions.get(key).toJSON();
    const curProblems = model.getFuncProblems(key);
    const ioProblems = funcIOProblems(model, key, func);
    const newProblems = curProblems.filter(p => !p[1].split(',').includes('io')).concat(ioProblems);
    if (!deepEquals(curProblems, newProblems)) { model.setFuncProblems(key, newProblems); }
}
/**
 * Updates the I/O problems for the given functions and all of its parent functions. Updates the
 * problems attribute of each function as needed.
 * @param {*} model 
 * @param {string} key - the key of the function to update 
 * @param {object} options
 * @param {Set<string>} visited - do not provide, used to avoid infinite recursion
 */
function funcIOProblemsUpdateParents(model, key, options = {}, visited = new Set()) {
    if (options.callGraphOnly) { return; } // no I/O problem checking
    if (visited.has(key)) { return; } // avoid infinite recursion
    visited.add(key);
    funcIOProblemsUpdate(model, key);
    for (const parent of model.callingFunctions[key] || []) {
        funcIOProblemsUpdateParents(model, parent, options, visited);
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
 * Checks if a function name is not unique within the model.
 * @param {*} model
 * @param {string} key
 * @param {string} name 
 * @returns {boolean} True if the function name is not unique, false otherwise
 */
export function isFunctionNameNotUnique(model, key, name) {
    if (!name || !model) { return false; }
    const functions = Array.from(model.functions);
    return functions.some(kf => kf[0] !== key && kf[1].get('name')?.toString()?.trim() === name);
}

/**
 * Checks for problems with a specific function.
 * @param {*} model 
 * @param {string} key 
 * @param {object} options
 * @param {boolean} fix - If true, attempts to fix problems where possible
 * @returns array of problems found: [ [severity, field, message], ... ]
 */
function funcProblems(model, key, options={}, fix=false) {
    const problems = [];
    const func = model.functions.get(key).toJSON();

    const name = (func['name'] || '').trim();
    const nameProblem = checkName(name, "Function", "name");
    if (nameProblem) { problems.push(nameProblem); }
    if (isFunctionNameNotUnique(model, key, name)) { problems.push(["error", "name", "Function name must be unique."]); }
    if (options.callGraphOnly) { return problems; }

    const isMain = name === 'main';
    const desc = (func['desc'] || '').trim();
    const params = func['params'] || [];
    const returns = func['returns'] || [];
    const io = func['io'] || 'none';
    const testable = func['testable'] || false;
    if (isMain) {
        if (fix) {
            if (desc.length > 0 || params.length > 0 || returns.length > 0) {
                model.model.transact(() => {
                    model.updateFunc(key, 'desc', '');
                    model.updateFunc(key, 'params', []);
                    model.updateFunc(key, 'returns', []);
                }, "fixing main function properties");
            }
        } else {
            if (desc.length > 0) { problems.push(["warning", "desc", "Main function does not need a description."]); }
            if (params.length > 0) { problems.push(["error", "params", "Main function should not have parameters."]); }
            if (returns.length > 0) { problems.push(["error", "returns", "Main function should not return values."]); }
        }
    } else {
        if (desc.length === 0) { problems.push(["warning", "desc", "Function description is required."]); }
        else if (desc.length < (options.minFuncDescLength ?? 20)) { problems.push(["warning", "desc", "Function description is too short - be more descriptive!"]); }
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
            else if (param.desc.length < (options.minParamDescLength ?? 20)) { problems.push(["warning", `params[${i}].desc`, "Parameter description is too short - be more descriptive!"]); }
        }
        for (let i = 0; i < returns.length; i++) {
            const ret = returns[i];
            if (!ret.type) { problems.push(["error", `returns[${i}].type`, "Return value type is required."]); }
            if (!ret.desc) { problems.push(["error", `returns[${i}].desc`, "Return value description is required."]); }
            else if (ret.desc.length < (options.minReturnDescLength ?? 20)) { problems.push(["warning", `returns[${i}].desc`, "Return value description is too short - be more descriptive!"]); }
        }
    }

    if (testable && params.length === 0) { problems.push(["warning", "testable,params", "Testable functions should have at least one parameter."]); }
    if (testable && returns.length === 0) { problems.push(["warning", "testable,returns", "Testable functions should have at least one return value."]); }
    problems.push(...funcIOProblems(model, key, func));
    return problems;
}
