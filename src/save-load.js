/**
 * Functions for saving/loading the function planner model, either as JSON
 * or as Python code.
 * 
 * The exported functions are:
 *  - setupDragAndDrop(model, options={}, div)
 *  - pythonDefLine(name, params, returns, withTypes=true, simple=false)
 *  - exportToPython(model, options, withTypes=true)
 *  - exportPythonTests(model, options)
 *  - reset(model, options, confirm=true)
 *  - saveJSON(model, options, includeProblems=false)
 *  - loadJSON(model, options)
 *  - importJSON(model, options)
 */

import Swal from 'sweetalert2';

import pythonIcon from '../images/python.svg';
import unitTestsIcon from '../images/unit-tests.svg';
import saveIcon from '../images/save.svg';

export const DEFAULT_PROGRAM_HEADER = "TODO: program header";
const DRAG_OVER_CLASS = 'func-planner-drag-over';

function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then();
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

function wrapText(text, {width=80, indent=4, firstLineIndent=indent}) {
    firstLineIndent = " ".repeat(firstLineIndent);
    indent = " ".repeat(indent);
    return text.split("\n").map((para, i) => {
        const lines = [];
        let curLine = i === 0 ? firstLineIndent : indent;
        para.trim().split(" ").forEach((word) => {
            if ((curLine + " " + word).length > width) {
                lines.push(curLine);
                curLine = indent + word;
            } else {
                curLine += " " + word;
            }
        });
        lines.push(curLine);
        return lines.join("\n");
    }).join("\n");
}
function wrapText48(text) {
    return wrapText(text, {indent: 8, firstLineIndent: 4});
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
        const returnTypes = returns.map(ret => ret.type ? typeToPython(ret.type) : "object");
        returnDef = " -> " + ((returns.length === 1) ? returnTypes[0] : `tuple[${returnTypes.join(", ")}]`);
    }
    const def = `${name}(${paramsDef.join(", ")})${returnDef}`;
    return simple ? def : `def ${def}:`;
}
class DocstringFormatter {
    paramHeader = '';
    returnHeader = '';
    param(name, desc, type) { return ''; }
    return(desc, type) { return ''; }
}
class NumpyDocstringFormatter extends DocstringFormatter {
    paramHeader = 'Parameters\n----------\n';
    returnHeader = 'Returns\n-------\n';
    param(name, desc, type) { return wrapText48(name + (type ? ` : ${type}` : "") + `\n${desc}\n`); }
    return(desc, type) { return wrapText48((type ? type : "object") + `\n${desc}\n`); }
}
class GoogleDocstringFormatter extends DocstringFormatter {
    paramHeader = 'Args:\n';
    returnHeader = 'Returns:\n';
    param(name, desc, type) { return wrapText(`${name}${type ? ` (${type})` : ""}: ${desc}`, {indent: 12, firstLineIndent: 8}); }
    return(desc, type) { return wrapText(`${type ? type : "object"}: ${desc}`, {indent: 12, firstLineIndent: 8}); }
}
class SphinxDocstringFormatter extends DocstringFormatter {
    param(name, desc, type) { return wrapText48(`:param ${name}: ${desc}`) + "\n" + (type ? wrapText48(`:type ${name}: ${type}`) + "\n" : ""); }
    return(desc, type) { return wrapText48(`:return: ${desc}`) + "\n" + (type ? wrapText48(`:rtype: ${type}`) + "\n" : ""); }
}
class EpydocDocstringFormatter extends DocstringFormatter {
    param(name, desc, type) { return wrapText48(`@param ${name}: ${desc}`) + "\n" + (type ? wrapText48(`@type ${name}: ${type}`) + "\n" : ""); }
    return(desc, type) { return wrapText48(`@return: ${desc}`) + "\n" + (type ? wrapText48(`@rtype: ${type}`) + "\n" : ""); }
}
const DOCSTYLES = {
    "numpy": NumpyDocstringFormatter(),
    "google": GoogleDocstringFormatter(),
    "sphinx": SphinxDocstringFormatter(),
    "epydoc": EpydocDocstringFormatter(),
}
function pythonDocstring(desc, options, params, returns) {
    let docstring = `    """\n${wrapText(desc)}\n\n`;
    const docStyle = (options.docStyle || "numpy").toLowerCase(); // default is numpy: easy to read and explicitly supports multiple returns
    if (!DOCSTYLES[docStyle]) { console.warn(`Unknown docstring style: ${docStyle}. Defaulting to numpy style.`); }
    const formatter = DOCSTYLES[docStyle] || DOCSTYLES["numpy"];
    if (formatter.paramHeader && params.length > 0) { docstring += `    ${formatter.paramHeader}`; }
    for (const [i, param] of params.entries()) {
        docstring += formatter.param(param.name || letter(i), param.desc || "TODO", param.type);
    }
    if (formatter.returnHeader && returns.length > 0) {
        if (params.length > 0) { docstring += "\n"; }
        docstring += `    ${formatter.returnHeader}`;
    }
    for (const [i, ret] of returns.entries()) {
        docstring += formatter.return(ret.desc || "TODO", ret.type);
    }
    docstring += `    """\n`;
    return docstring;
}
function authorString(authors) {
    return (authors.length === 0) ? 'TODO' :
         (authors.length === 1) ? authors[0] :
         (authors.slice(0, -1).join(', ') + ' and ' + authors.slice(-1)[0])
}
// if authors is null, use all authors and don't split it up
// if authors is provided, only include those authors in the export (array or string)
// if authors is contains an empty string, include the unspecified author functions as well
function dealWithAuthors(model, authors) {
    const modelAuthors = model.modelData.get('authors')?.toJSON() || [];

    const includeAll = authors == null;
    const includeUnspecified = authors === '' || (Array.isArray(authors) && authors.includes(''));
    if (includeAll) { authors = modelAuthors; }
    // ensures that authors is always an array of trimmed non-empty strings, even if the input is a single string or null/undefined
    authors = (Array.isArray(authors) ? authors : (typeof authors === 'string' ? [authors] : [])).map(name => name.trim()).filter(name => name.length > 0);

    const by = includeUnspecified ? authorString(modelAuthors) : authorString(authors);

    const functions = Array.from(model.functions.entries()).filter(([key, func]) => {
        const owner = func.get('owner')?.toString() || '';
        return includeAll || (includeUnspecified && owner === '') || authors.includes(owner);
    });

    return { by, functions };
}
// Performs a topological sort of the functions based on calls to ensure that called functions are
// defined before they are called. If there is a cycle, somewhat ignore it.
function sortFunctions(model, functions) {
    const sortedKeys = [];
    const visited = new Set();

    function visit(key) {
        if (visited.has(key)) { return; }
        visited.add(key);
        for (const calledKey of (model.calledFunctions[key] || [])) { visit(calledKey); }
        sortedKeys.push(key);
    }

    for (const [key] of functions) {
        if (!model.callingFunctions[key]) { visit(key); }
    }

    const funcMap = Object.fromEntries(functions);
    return sortedKeys.map(key => [key, funcMap[key]]);
}
function generatePythonTemplate(model, options, authors=null, withTypes=true) {
    const data = model.modelData.toJSON();
    const { by, functions } = dealWithAuthors(model, authors);
    let text = `"""\n${data.documentation || DEFAULT_PROGRAM_HEADER}\n\nBy: ${by}\n"""\n\n`;
    if (data.globalCode) { text += `${data.globalCode}\n\n`; }
    const funcs = sortFunctions(model, functions);
    let hasMainFunc = false;

    for (const [key, func] of funcs) {
        // Create the def line
        const name = func.get("name")?.toString() || `function${key}`;
        if (name === 'main') { hasMainFunc = true; }
        const params = func.get("params")?.toJSON() || [];
        const returns = func.get("returns")?.toJSON() || [];
        let funcText = pythonDefLine(name, params, returns, withTypes) + "\n";

        // Create the docstring
        const desc = func.get("desc")?.toString() || "";
        if (desc) { funcText += pythonDocstring(desc, options, params, returns); }

        const code = func.get("code")?.toString() || "";
        if (code) {
            // Pre-provided code if available
            funcText += indentText(code, 4);
        } else {
            // Body comments
            funcText += "    # TODO: implement this function\n";
            const calls = model.calledFunctions[key]?.map(
                toKey => model.functions.get(toKey)?.get("name")?.toString() || `function${toKey}`
            );
            if (calls?.length > 0) { funcText += `    # Calls ${calls.map(call => call + "()").join(", ")}\n`; }
            const io = func.get("io") || "none";
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

        text += funcText + "\n\n\n";
    }
    if (hasMainFunc) { text += 'if __name__ == "__main__":\n    main()\n'; }
    text = text.replace(/[ \t\f\v]+$/gm, '');  // remove all trailing whitespace
    return text;
}
/**
 * Exports the model to a Python template and copies it to the clipboard.
 * @param {*} model
 * @param {object} options
 * @param {boolean} withTypes Whether to include type annotations.
 */
export function exportToPython(model, options, withTypes=true) {
    exportTemplate(
        model, options, (model, authors = null) => generatePythonTemplate(model, options, authors, withTypes),
        "Python Template Copied", pythonIcon,
        "Python template copied to clipboard.<br>Paste it into a Python file.",
    )
}
function generatePythonTests(model, authors=null) {
    const data = model.modelData.toJSON();
    const { by, functions } = dealWithAuthors(model, authors);
    let text = `"""\n${data.testDocumentation || "Tests for the " + model.id + " module"}\n\nBy: ${by}\n"""\n\nimport pytest\n\nimport ` + model.id + `\n\n`;
    if (data.testGlobalCode) { text += `${data.testGlobalCode}\n\n`; }

    for (const [key, func] of functions) {
        if (func.get("testable")) {
            const name = func.get("name")?.toString() || `function${key}`;
            const testCode = func.get("testCode")?.toString() || "";
            text += `def test_${name}():\n`;
            text += testCode ? indentText(testCode, 4) : `    # TODO: write tests for ${name}()\n    pass`;
            text += `\n\n`;
        }
    }
    text += `if __name__ == '__main__':\n    pytest.main(["--no-header", "--tb=short"])\n`;
    text = text.replace(/[ \t\f\v]+$/gm, '');  // remove all trailing whitespace
    return text;
}
/**
 * Exports the model to a Python test template and copies it to the clipboard.
 * @param {*} model 
 */
export function exportPythonTests(model, options={}) {
    exportTemplate(
        model, options, generatePythonTests,
        "Python Unit Tests Copied", unitTestsIcon,
        "Python unit tests copied to clipboard.<br>Paste it into a Python file that ends with <code>_test.py</code>.",
        "_test",
    )
}

function dataURL(text, mime='text/plain;charset=utf-8') {
    return `data:${mime},${encodeURIComponent(text)}`;
}

function exportTemplate(
    model, options, generateFunc,
    title, icon, desc, filenameSuffix="",
) {
    const text = generateFunc(model, null);
    copyToClipboard(text);
    const link = `<a class="download-link" href="${dataURL(text)}" download="${model.id}${filenameSuffix}.py">Click here to download it.</a>`;
    const descWithLink = `${desc}<br>${link}`;

    if (options.canClaimFuncs) {
        const authors = model.modelData.get('authors')?.toJSON() || [];
        Swal.fire({
            theme: options.theme,
            imageUrl: icon,
            imageWidth: "6em",
            title: title,
            html: `Change author: <select>
            <option value="">All Combined in one file</option><option value="">Shared/Not Specified</option>
            ${authors.map(author => `<option value="${author}">${author}</option>`).join("")}
            </select><br><br>${descWithLink}`,
            showCloseButton: true,
            willOpen: (popup) => {
                const select = popup.querySelector("select");
                const downloadLink = popup.querySelector("a.download-link");
                select.addEventListener("change", () => {
                    const selected = select.value;
                    const text = generateFunc(model, select.selectedIndex === 0 ? null : selected);
                    copyToClipboard(text);
                    downloadLink.href = dataURL(text);
                    downloadLink.download = `${model.id}${selected ? `_${selected}` : ""}.py`;
                });
            }
        });
    } else {
        Swal.fire({
            theme: options.theme,
            imageUrl: icon,
            imageWidth: "6em",
            title: title,
            html: descWithLink,
            showCloseButton: true,
        });
    }
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
    }).then((res) => { if (res.isConfirmed) { confirmFunc(); } });
}

function mergeModel(model, data) {
    const maxKey = Array.from(model.functions).reduce((max, n) => Math.max(max, parseInt(n.key)), -1);
    data.model.transact(() => {
        data.functions.forEach(func => {
            const key = (parseInt(func.key) + maxKey).toString();
            func = { ...func };
            delete func.key;
            model.functions.set(key, model.convertFuncData(func));
        });
        data.calls.forEach(call => {
            const from = (parseInt(call.from) + maxKey).toString();
            const to = (parseInt(call.to) + maxKey).toString();
            model.calls.set(`${from}-${to}`, true);
        });
    });
}

/**
 * Reset the model to the initial model.
 * @param {*} model
 * @param {*} options
 * @param {boolean} confirm Whether to show a confirmation dialog.
 */
export function reset(model, options, confirm=true) {
    if (confirm) {
        confirmDialog("Reset to Default?", "Are you sure you want to load the default functions for this plan? This will clear the current plan.",
            () => { reset(model, options, false); }, options.theme);
    } else { model.resetModel(); }
}

/**
 * Save the model as JSON and copy it to the clipboard.
 * @param {*} model 
 * @param {object} options
 */
export function saveJSON(model, options={}) {
    const data = model.exportModel();
    const json = JSON.stringify(data, null, 2);
    copyToClipboard(json);
    Swal.fire({
        theme: options.theme,
        imageUrl: saveIcon,
        imageWidth: "6em",
        title: "JSON Copied",
        html: "JSON version copied to clipboard.<br>Save to a file so it can be reloaded later.<br>" +
            `<a href="${dataURL(json, 'application/json')}" download="${model.id}-plan.json">Click here to download it.</a>`,
        showCloseButton: true,
    });
}
/**
 * Load JSON data into the model, replacing the current model.
 * @param {*} model
 * @param {object} options 
 */
export function loadJSON(model, options={}) {
    Swal.fire({
        theme: options.theme,
        title: "Load JSON",
        html: "Paste the JSON data below.<br>This will <em>overwrite</em> the current plan.",
        input: "textarea",
        showCancelButton: true,
        showCloseButton: true,
        inputValidator: (value) => {
            if (!value) { return "JSON data is required."; }
            try {
                const data = JSON.parse(value);
                if (!data.functions || !data.calls) { return "Invalid JSON format. Expected 'functions' and 'calls' keys at a minimum."; }
            } catch (e) { return "Invalid JSON format"; }
            return null;
        },
    }).then((result) => {
        if (!result.isConfirmed) { return; }
        loadJSONString(model, options, result.value, false);
    });
}
/**
 * Import JSON data into the model, "merging" with the current model.
 * @param {*} model
 * @param {object} options 
 */
export function importJSON(model, options={}) {
    Swal.fire({
        theme: options.theme,
        title: "Import JSON",
        html: "Select a JSON file to import.<br>This will <em>merge</em> the current plan.",
        input: "textarea",
        showCancelButton: true,
        showCloseButton: true,
        inputValidator: (value) => {
            if (!value) { return "JSON data is required."; }
            try {
                const data = JSON.parse(value);
                if (!data.functions || !data.calls) { return "Invalid JSON format. Expected 'functions' and 'calls' keys."; }
            } catch (e) { return "Invalid JSON format"; }
            return null;
        },
    }).then((result) => {
        if (!result.isConfirmed) { return; }
        loadJSONString(model, options, result.value, true);
    });
}

function loadJSONString(model, options={}, json, merge=false) {
    try {
        const data = JSON.parse(json);
        if (!data.functions || !data.calls) { throw new Error("Invalid JSON format. Expected 'functions' and 'calls' keys at a minimum."); }
        if (merge) { mergeModel(model, data); }
        else { model.importModel(data); }
    } catch (e) {
        console.error("Invalid JSON data:", e);
        Swal.fire({
            theme: options.theme,
            title: "Invalid JSON",
            text: "The JSON data is invalid.",
            icon: "error",
            showCloseButton: true,
        });
    }
}

function loadJSONFile(model, options={}, file) {
    const reader = new FileReader();
    reader.onload = () => { loadJSONString(model, options, reader.result); };
    reader.onerror = () => { Swal.fire({
        theme: options.theme,
        title: "File Error",
        text: "Error reading the file. Please try again.",
        icon: "error",
        showCloseButton: true,
    }); };
    reader.readAsText(file);
}

export function setupDragAndDrop(model, options={}, div) {
    div.addEventListener("drop", (e) => {
        e.preventDefault();
        div.classList.remove(DRAG_OVER_CLASS);

        if (e.dataTransfer.items) {
            // TODO: dragging from VS Code comes over as a set of strings?
            // console.log([...e.dataTransfer.items].filter(item => item.kind === "file").length,
            //     [...e.dataTransfer.items].filter(item => item.kind === "string").length);
            // console.log(e.dataTransfer.files.length);

            // const items = e.dataTransfer.items;
            // if (items.length >= 3 && items[0].kind === "string" && items[1].kind === "string" && items[2].kind === "string") {
            //     items[1].getAsString((str) => { if (str.startsWith("file://")) {
            //         [...items].forEach((item, i) => {
            //             if (item.kind === "file") { console.log(i, "dnd - file:", item.getAsFile().name); }
            //             else if (item.kind === "string") { item.getAsString((str) => { console.log(i, "dnd - str:", str); }); }
            //         });
            //     } });
            // }

            const item = e.dataTransfer.items[0];
            if (item.kind === "file") { loadJSONFile(model, options, item.getAsFile()); }
            else if (item.kind === "string") {
                item.getAsString((str) => {
                    if (str.startsWith("{")) { loadJSONString(model, options, str); }
                });
            }
        } else if (e.dataTransfer.files) {
            loadJSONFile(model, options, e.dataTransfer.files[0]);
        }
    });
    div.addEventListener("dragenter", (e) => { e.preventDefault(); div.classList.add(DRAG_OVER_CLASS); });
    div.addEventListener("dragover", (e) => { e.preventDefault(); div.classList.add(DRAG_OVER_CLASS); });
    div.addEventListener("dragleave", (e) => { div.classList.remove(DRAG_OVER_CLASS); });
}
