/**
 * Functions for saving/loading the function planner diagram, either as JSON
 * or as Python code.
 * 
 * The exported functions are:
 *  - setupSaveLoad(diagram)
 *  - pythonDefLine(name, params, returns, withTypes=true, simple=false)
 *  - exportToPython(diagram, withTypes=true)
 *  - exportPythonTests(diagram)
 *  - reset(diagram, confirm=true)
 *  - saveJSON(diagram, includeProblems=false)
 *  - loadJSON(diagram)
 *  - importJSON(diagram)
 */

import { GraphLinksModel } from 'gojs';
import Swal from 'sweetalert2';

import { dup } from './utils.js';
import { updateAllProblems } from './problem-checker.js';

export const DEFAULT_PROGRAM_HEADER = "TODO: program header";
const DRAG_OVER_CLASS = 'func-planner-drag-over';
const LOCAL_STORAGE_KEY_PREFIX = 'func-planner-plan-';

/**
 * Setup save/load functionality for the given diagram. This includes loading
 * from localStorage on startup, saving to localStorage on changes, and
 * enabling drag-and-drop loading of JSON files.
 * @param {*} diagram
 */
export function setupSaveLoad(diagram) {
    const model = (localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${diagram.planId}`)) ?
        JSON.parse(localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${diagram.planId}`)) :
        dup(diagram.initialModel);
    rawSetModel(diagram, model);
    diagram.addModelChangedListener((e) => {
        // if (e.change === go.ChangeType.Transaction) {
        //     console.log("Transaction", e.propertyName, e.oldValue);
        // }
        if (e.isTransactionFinished) {
            //console.log("Saving model");
            localStorage.setItem(`${LOCAL_STORAGE_KEY_PREFIX}${diagram.planId}`, JSON.stringify(getModel(diagram)));
        }
    });
    setupDragAndDrop(diagram);
}

function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(textToCopy).then();
    } else {
        let textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
    }
}

function downloadDataAsFile(filename, text, mime='text/plain') {
  const link = document.createElement('a');
  link.href = 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(text);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function wrapText(text, width=80, indent=4) {
    width = width - indent;
    indent = " ".repeat(indent);
    text = text.replace(new RegExp(`(?![^\\n]{1,${width}}$)([^\\n]{1,${width}})\\s`, 'g'), indent + '$1\n');
    let lastBreak = text.lastIndexOf("\n");
    if (lastBreak === -1) { return `${indent}${text}`; }
    text = text.slice(0, lastBreak) + "\n" + indent + text.slice(lastBreak + 1);
    return text;
}
function indentText(text, indent=4) {
    indent = " ".repeat(indent);
    return text.split("\n").map(line => indent + line).join("\n");
}

function splitOnMatchingParen(str) {
    let stack = [];
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '(') {
            stack.push(i);
        } else if (char === ')') {
            const matchIndex = stack.pop();
            if (matchIndex === 0) {
                return [str.slice(1, i).trim(), str.slice(i + 1).trim()];
            }
        }
    }
    return [null, str];
}
function splitOnCommasIgnoringParens(str) {
    const results = [];
    let current = '';
    let parenDepth = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '(') {
            parenDepth++;
            current += char;
        } else if (char === ')') {
            parenDepth--;
            current += char;
        } else if (char === ',' && parenDepth === 0) {
            // Split here - comma is not inside parentheses
            results.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    // Add the last part
    if (current) { results.push(current.trim()); }
    return results;
}
function removeOuterParens(text) {
    text = text.trim();
    if (text.startsWith("(") && text.endsWith(")")) {
        let [part, rest] = splitOnMatchingParen(text);
        if (rest === "") { return part; }
    }
    return text;
}
function normalizeString(text) {
    return removeOuterParens(text.trim().replace(/\s+/g, ' '));
}
function mapList(text, fn) {
    text = normalizeString(text);
    text = text.replace(/, ?and\b/, ',').replace(/ and\b/, ', ');  // normalize "and"s to commas
    return splitOnCommasIgnoringParens(text).map(x => fn(x.trim(), true)).join(", ");
}

function processDictType(type, fn) {
    type = type.slice(10);
    let [key, value] = type.split(" associated with ");  // TODO: nested
    if (key.startsWith("keys of ")) { key = key.slice(8); }
    if (value.startsWith("values of ")) { value = value.slice(10); }
    return [fn(key, true), fn(value, true)];
}
function processPlural(type) {
    // first word can be ints, floats, strs, bools, tuples, dicts, sets
    let parts = type.split(" ");
    if (parts[0].endsWith("s")) { parts[0] = parts[0].slice(0, -1); } // remove trailing 's' for plural types
    return parts.join(" ");
}

const DEFAULT_VALUES = {
    "int": "0",
    "str": '""',
    "float": "0.0",
    "bool": "False",
    "list": "[]",
    "tuple": "()",
    "dict": "{}",
    "set": "set()",
}
function defaultReturnValue(type, plural=false) {
    type = normalizeString(type);
    if (plural) { type = processPlural(type); }
    if (DEFAULT_VALUES[type]) { return DEFAULT_VALUES[type]; }
    if (type.startsWith("list of ")) { return `[${defaultReturnValue(type.slice(8), true)}]`; }
    if (type.startsWith("list with ")) { return `[${mapList(type.slice(10), defaultReturnValue)}]`; }
    if (type.startsWith("tuple of ")) { return `(${defaultReturnValue(type.slice(9), true)},)`; }
    if (type.startsWith("tuple with ")) { return `(${mapList(type.slice(11), defaultReturnValue)})`; }
    if (type.startsWith("dict of ")) { return `{"": ${defaultReturnValue(type.slice(8), true)}}`; }
    if (type.startsWith("dict with ")) { return `{${processDictType(type, defaultReturnValue).join(": ")}}`; }
    if (type.startsWith("set of ")) { return `{${defaultReturnValue(type.slice(7), true)}}`; }
    return "None";
}
function typeToPython(type, plural=false) {
    type = normalizeString(type);
    if (plural) { type = processPlural(type); }
    if (type.startsWith("list of ")) { return `list[${typeToPython(type.slice(8), true)}]`; }  // homogeneous list
    if (type.startsWith("list with ")) { return `list[${mapList(type.slice(10), typeToPython)}]`; }  // heterogeneous list (technically not supported in Python)
    if (type.startsWith("tuple of ")) { return `tuple[${typeToPython(type.slice(9), true)}, ...]`; }  // homogeneous tuple
    if (type.startsWith("tuple with ")) { return `tuple[${mapList(type.slice(11), typeToPython)}]`; }  // heterogeneous tuple
    if (type.startsWith("dict of ")) { return `dict[str, ${typeToPython(type.slice(8), true)}]`; }  // dict with keys as strings
    if (type.startsWith("dict with ")) { return `dict[${processDictType(type, typeToPython).join(", ")}]`; }  // dict with specified key and value types
    if (type.startsWith("set of ")) { return `set[${typeToPython(type.slice(7), true)}]`; }  // homogeneous set
    return type;
}


const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function letter(n) { return ALPHABET.charAt(n % ALPHABET.length); }
function getParam(param, i, withTypes=true) {
    let name = (param.name || letter(i)).trim();
    if (!withTypes || !param.type) { return name; }
    return `${name}: ${typeToPython(param.type)}`;
}
/**
 * Generates a Python function definition line.
 * @param {string} name The function name.
 * @param {*} params The function parameters.
 * @param {*} returns The function return types.
 * @param {boolean} withTypes Whether to include type annotations.
 * @param {boolean} simple Whether to generate a simple def line without the "def" keyword and colon.
 * @returns {string} The Python function def line.
 */
export function pythonDefLine(name, params, returns, withTypes=true, simple=false) {
    const paramsDef = params.map((p, i) => getParam(p, i, withTypes));
    let returnDef = "";
    if (withTypes && returns.length > 0) {
        const returnTypes = returns.map(ret => typeToPython(ret.type));
        returnDef = " -> " + ((returns.length === 1) ? returnTypes[0] : `tuple[${returnTypes.join(", ")}]`);
    }
    const def = `${name}(${paramsDef.join(", ")})${returnDef}`;
    return simple ? def : `def ${def}:`;
}
function formatListInDocstring(name, list, formatItem) {
    let output = "";
    if (list.length === 1) {
        output = `    ${name}: ${formatItem(list[0], 0)}\n`;
    } else if (list.length > 1) {
        output = `    ${name}s:\n`;
        for (let [i, item] of list.entries()) { output += `        ${formatItem(item, i)}\n`; }
    }
    return output;
}
function pythonDocstring(desc, params, returns) {
    let docstring = `    """\n${wrapText(desc)}\n\n`;
    docstring += formatListInDocstring("Parameter", params, (p, i) => `${p.name || letter(i)} (${p.type}): ${p.desc}`);
    docstring += formatListInDocstring("Return", returns, (ret, i) => `${ret.type}: ${ret.desc}`);
    docstring += `    """\n`;
    return docstring;
}
function generatePythonTemplate(diagram, withTypes=true) {
    const model = diagram.model;
    let text = `"""\n${model.documentation || DEFAULT_PROGRAM_HEADER}\n\nBy: ${model.authors || "TODO"}\n"""\n\n`;
    if (model.globalCode) { text += `${model.globalCode}\n\n`; }
    let mainFunc = null;
    // TODO: sort?
    for (const func of diagram.model.nodeDataArray) {
        // Create the def line
        let name = func.name || `function${func.key}`;
        let params = func.params || [];
        let returns = func.returns || [];
        let funcText = pythonDefLine(name, params, returns, withTypes) + "\n";

        // Create the docstring
        let desc = func.desc || "";
        if (desc) { funcText += pythonDocstring(desc, params, returns); }

        let code = func.code || "";
        if (code) {
            // Pre-provided code if available
            funcText += indentText(code, 4);
        } else {
            // Body comments
            funcText += "    # TODO: implement this function\n";
            const node = diagram.findNodeForData(func);
            const calls = Array.from(node.findNodesOutOf()).map(c => c.data.name || `function${c.data.key}`);
            if (calls.length > 0) { funcText += `    # Calls ${calls.map(call => call + "()").join(", ")}\n`; }
            let io = func.io || "none";
            if (io === "validation") { funcText += `    # Has direct user input that requires validation\n`; }
            else if (io === "input") { funcText += `    # Has direct user input\n`; }
            else if (io === "output") { funcText += `    # Has direct user output\n`; }

            // Dummy return statement
            if (returns.length > 0) {
                funcText += `    return ${returns.map(ret => defaultReturnValue(ret.type)).join(", ")}`;
            } else {
                funcText += "    pass";
            }
        }

        if (func.name === 'main') { mainFunc = funcText; }
        else { text += funcText + "\n\n\n"; }
    }
    if (mainFunc) {
        text += mainFunc + '\n\n\nif __name__ == "__main__":\n    main()\n';
    }
    return text;
}
/**
 * Exports the diagram to a Python template and copies it to the clipboard.
 * @param {*} diagram 
 * @param {boolean} withTypes Whether to include type annotations.
 */
export function exportToPython(diagram, withTypes=true) {
    const text = generatePythonTemplate(diagram, withTypes);
    copyToClipboard(text);
    Swal.fire({
        theme: diagram.themeManager.currentTheme,
        imageUrl: 'images/python.svg',
        imageWidth: "6em",
        title: "Python Template Copied",
        html: "Python template copied to clipboard.<br>Paste it into a Python file.<br>" +
            "<a href=\"data:text/plain;charset=utf-8," + encodeURIComponent(text) + "\" download=\"" + diagram.planId + ".py\">Click here to download it.</a>",
        showCloseButton: true,
    });
}
function generatePythonTests(diagram) {
    const model = diagram.model;
    let text = `"""\n${model.testDocumentation || "Tests for the " + diagram.planId + " module"}\n\nBy: ${model.authors || "TODO"}\n"""\n\nimport pytest\n\nimport ` + diagram.planId + `\n\n`;
    for (const func of model.nodeDataArray) {
        if (func.testable) {
            text += `def test_${func.name}():\n`;
            text += func.testCode ? indentText(func.testCode, 4) : `    # TODO: write tests for ${func.name}()\n    pass`;
            text += `\n\n`;
        }
    }
    text += `if __name__ == '__main__':\n    pytest.main(["--no-header", "--tb=short"])\n`;
    return text;
}
/**
 * Exports the diagram to a Python test template and copies it to the clipboard.
 * @param {*} diagram 
 */
export function exportPythonTests(diagram) {
    const text = generatePythonTests(diagram);
    copyToClipboard(text);
    Swal.fire({
        theme: diagram.themeManager.currentTheme,
        imageUrl: 'images/unit-tests.svg',
        imageWidth: "6em",
        title: "Python Unit Tests Copied",
        html: "Python unit tests copied to clipboard.<br>Paste it into a Python file that ends with <code>_test.py</code>.<br>" +
            "<a href=\"data:text/plain;charset=utf-8," + encodeURIComponent(text) + "\" download=\"" + diagram.planId + "_test.py\">Click here to download it.</a>",
        showCloseButton: true,
    });

}

function confirmDialog(title, text, confirmFunc, theme='auto') {
    Swal.fire({
        title: title,
        text: text,
        icon: "warning",
        theme: theme,
        showCancelButton: true,
        showCloseButton: true,
        focusConfirm: false,
    }).then((confirm) => { if (confirm) { confirmFunc(); } });
}
function rawSetModel(diagram, model) {
    diagram.model = new GraphLinksModel(model.functions, model.calls);
    diagram.model.documentation = model.documentation ?? '';
    diagram.model.testDocumentation = model.testDocumentation ?? '';
    diagram.model.globalCode = model.globalCode ?? '';
    diagram.model.readOnly = model.readOnly || false;
    diagram.model.authors = model.authors ?? '';
    if (model.showTestDocumentation) { diagram.model.showTestDocumentation = model.showTestDocumentation; }
    if (model.showGlobalCode) { diagram.model.showGlobalCode = model.showGlobalCode; }
}
function setModel(diagram, model) {
    if (!model.functions || !model.calls) { return "Invalid model format. Expected 'functions' and 'calls' keys."; }
    rawSetModel(diagram, model);
    updateAllProblems(diagram);
}
function mergeModel(diagram, model) {
    if (!model.functions || !model.calls) { return "Invalid model format. Expected 'functions' and 'calls' keys."; }
    const maxKey = diagram.model.nodeDataArray.reduce((max, n) => Math.max(max, n.key), -1);
    model.functions.forEach(func => { func.key += maxKey; });
    model.calls.forEach(call => { call.from += maxKey; call.to += maxKey; });
    diagram.model.addNodeDataCollection(model.functions);
    diagram.model.addLinkDataCollection(model.calls);
    updateAllProblems(diagram);
}
/**
 * Reset the diagram to the initial model.
 * @param {*} diagram 
 * @param {boolean} confirm Whether to show a confirmation dialog.
 */
export function reset(diagram, confirm=true) {
    if (confirm) {
        confirmDialog("Reset to Default?", "Are you sure you want to load the default functions for this plan? This will clear the current plan.",
            () => { reset(diagram, false); }, diagram.themeManager.currentTheme);
    } else { setModel(diagram, dup(diagram.initialModel)); }
}

function removeProblems(array) {
    return array.map(item => {
        let data = { ...item };
        delete data.problems;
        delete data.linkProblems;
        return data;
    });
}
function getModel(diagram, includeProblems=false) {
    const model = diagram.model;
    const functions = includeProblems ? model.nodeDataArray : removeProblems(model.nodeDataArray);
    const calls = includeProblems ? model.linkDataArray : removeProblems(model.linkDataArray);
    const output = { functions, calls }
    for (const key of ['documentation', 'testDocumentation', 'globalCode', 'readOnly', 'authors', 'showTestDocumentation', 'showGlobalCode']) {
        if (model[key]) {
            output[key] = model[key];
        }
    }
    return output;
}
/**
 * Save the diagram as JSON and copy it to the clipboard.
 * @param {*} diagram 
 * @param {boolean} includeProblems Whether to include problem data in the saved JSON.
 */
export function saveJSON(diagram, includeProblems=false) {
    const model = getModel(diagram, includeProblems);
    const json = JSON.stringify(model, null, 2);
    copyToClipboard(json);
    Swal.fire({
        theme: diagram.themeManager.currentTheme,
        imageUrl: 'images/save.svg',
        imageWidth: "6em",
        title: "JSON Copied",
        html: "JSON version copied to clipboard.<br>Save to a file so it can be reloaded later.<br>" +
            "<a href=\"data:application/json;charset=utf-8," + encodeURIComponent(json) + "\" download=\"" + diagram.planId + "-plan.json\">Click here to download it.</a>",
        showCloseButton: true,
    });
}
/**
 * Load JSON data into the diagram, replacing the current model.
 * @param {*} diagram 
 */
export function loadJSON(diagram) {
    Swal.fire({
        theme: diagram.themeManager.currentTheme,
        title: "Load JSON",
        html: "Paste the JSON data below.<br>This will <em>overwrite</em> the current plan.",
        input: "textarea",
        showCancelButton: true,
        showCloseButton: true,
        inputValidator: (value) => {
            if (!value) { return "JSON data is required."; }
            try {
                const model = JSON.parse(value);
                if (!model.functions || !model.calls) { return "Invalid JSON format. Expected 'functions' and 'calls' keys."; }
            } catch (e) { return "Invalid JSON format"; }
            return null;
        },
    }).then((result) => {
        if (!result.isConfirmed) { return; }
        loadJSONString(diagram, result.value, false);
    });
}
/**
 * Import JSON data into the diagram, "merging" with the current model.
 * @param {*} diagram 
 */
export function importJSON(diagram) {
    Swal.fire({
        theme: diagram.themeManager.currentTheme,
        title: "Import JSON",
        html: "Select a JSON file to import.<br>This will <em>merge</em> the current plan.",
        input: "textarea",
        showCancelButton: true,
        showCloseButton: true,
        inputValidator: (value) => {
            if (!value) { return "JSON data is required."; }
            try {
                const model = JSON.parse(value);
                if (!model.functions || !model.calls) { return "Invalid JSON format. Expected 'functions' and 'calls' keys."; }
            } catch (e) { return "Invalid JSON format"; }
            return null;
        },
    }).then((result) => {
        if (!result.isConfirmed) { return; }
        loadJSONString(diagram, result.value, true);
    });
}

function loadJSONString(diagram, json, merge=false) {
    try {
        const model = JSON.parse(json);
        if (!model.functions || !model.calls) { throw new Error("Invalid JSON format. Expected 'functions' and 'calls' keys."); }
        if (merge) { mergeModel(diagram, model); }
        else { setModel(diagram, model); }
    } catch (e) {
        console.error("Invalid JSON data:", e);
        Swal.fire({
            theme: diagram.themeManager.currentTheme,
            title: "Invalid JSON",
            text: "The JSON data is invalid.",
            icon: "error",
            showCloseButton: true,
        });
    }
}

function loadJSONFile(diagram, file) {
    const reader = new FileReader();
    reader.onload = () => { loadJSONString(diagram, reader.result); };
    reader.onerror = () => { Swal.fire({
        theme: diagram.themeManager.currentTheme,
        title: "File Error",
        text: "Error reading the file. Please try again.",
        icon: "error",
        showCloseButton: true,
    }); };
    reader.readAsText(file);
}

function setupDragAndDrop(diagram) {
    const div = diagram.div;
    div.addEventListener("drop", (e) => {
        e.preventDefault();
        div.classList.remove(DRAG_OVER_CLASS);

        if (e.dataTransfer.items) {
            // TODO: dragging from VS Code comes over as a set of strings?
            // console.log([...e.dataTransfer.items].filter(item => item.kind === "file").length,
            //     [...e.dataTransfer.items].filter(item => item.kind === "string").length);
            // console.log(e.dataTransfer.files.length);

            const items = e.dataTransfer.items;
            if (items.length >= 3 && items[0].kind === "string" && items[1].kind === "string" && items[2].kind === "string") {
                items[1].getAsString((str) => { if (str.startsWith("file://")) {
                    [...items].forEach((item, i) => {
                        if (item.kind === "file") { console.log(i, "dnd - file:", item.getAsFile().name); }
                        else if (item.kind === "string") { item.getAsString((str) => { console.log(i, "dnd - str:", str); }); }
                    });
                } });
            }

            const item = e.dataTransfer.items[0];
            if (item.kind === "file") { loadJSONFile(diagram, item.getAsFile()); }
            else if (item.kind === "string") {
                item.getAsString((str) => {
                    if (str.startsWith("{")) { loadJSONString(diagram, str); }
                });
            }
        } else if (e.dataTransfer.files) {
            loadJSONFile(diagram, e.dataTransfer.files[0]);
        }
    });
    div.addEventListener("dragenter", (e) => { e.preventDefault(); div.classList.add(DRAG_OVER_CLASS); });
    div.addEventListener("dragover", (e) => { e.preventDefault(); div.classList.add(DRAG_OVER_CLASS); });
    div.addEventListener("dragleave", (e) => { div.classList.remove(DRAG_OVER_CLASS); });
}
