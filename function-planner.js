/**
 * This file contains the code for the function planner tool.
 * 
 * Future ideas:
 *  - more flexible type selection (click, dialog that designs the type)
 *  - better display of the first line of the function (make it look like Python)
 *  - generate testing code
 *  - more init options for what should be tested or in the menu
 *  - allow a plan to lock specific parts of a function (like it name) [if any part locked, no removal allowed]
 * 
 * Big idea:
 *  - make the diagram all that there is, clicking on a function brings up its information to be typed in
 *  - click and drag to create connections between functions
 */

import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/+esm';
// TODO: proper imports?
//import swal from 'https://unpkg.com/sweetalert/dist/sweetalert.min.js';
//import tippy from 'https://unpkg.com/tippy.js@6';

let allowed_types = ["int", "str", "float", "bool", "list of int", "list of str", "list of float", "list of bool", "tuple of int", "tuple of str", "tuple of float", "tuple of bool"];
let default_model = [];
let plan_name = "general";
let root_elem;
let functions_elem;
let callgraph_elem;

let model = [];
let previousModels = []; // undo stack


export default function init(rootElem, planName=null, defaultModel=null, allowedTypes=null, minFunctions=0, minTestable=0) {
    root_elem = rootElem;
    plan_name = planName || "general";
    default_model = defaultModel || [];
    allowed_types = allowedTypes || allowed_types;

    // Create the layout
    root_elem.innerHTML = '';

    callgraph_elem = document.createElement("div");
    callgraph_elem.className = "callgraph";
    root_elem.appendChild(callgraph_elem);

    functions_elem = document.createElement("div");
    functions_elem.className = "functions";
    root_elem.appendChild(functions_elem);

    createMenu(minFunctions, minTestable);

    // TODO: still want regular cmd-z to work in text fields
    //window.addEventListener("keydown", e => { if (e.key === "z" && e.metaKey) { undo(); } });

    // Load the function planner data from local storage
    model = JSON.parse(localStorage.getItem(plan_name)) || [];
    if (model.length === 0) {
        model = JSON.parse(JSON.stringify(default_model));
        saveModel(true);
    }
    previousModels.push(JSON.stringify(model));
    loadModel();

    //mermaid.initialize({securityLevel: 'loose'});
    setTimeout(createCallGraph, 10); // delay to allow mermaid to load
}

function createMenu(minFunctions=0, minTestable=0) {
    let menu = document.createElement("div");
    menu.className = "menu";
    menu.appendChild(createMenuButton("➕ Add Function", () => {
        addNewFunction();
        window.scrollTo(0, document.body.scrollHeight);
    }));
    if (default_model.length > 0) {
        menu.appendChild(createMenuButton("🔄 Load Defaults", loadDefaultPlan));
    } else {
        menu.appendChild(createMenuButton("🗑️ Clear All Data", clearPlan));
    }
    menu.appendChild(createMenuButton("✅︎ Perform Basic Checks", () => performBasicChecks(minFunctions, minTestable)));
    //menu.appendChild(createMenuButton("🔀 Create Call Graph", createCallGraph));
    menu.appendChild(createMenuButton("↩️ Undo", undo));
    //menu.appendChild(createMenuButton("📝 Export to Text", exportToText, "Export to a human-readable text format for submission"));
    menu.appendChild(createMenuButton("🐍 Create Python template", exportToPython, "Create a Python template of the plan"));
    menu.appendChild(createMenuButton("💾 Save JSON", saveJSON, "Save to a format which can be reloaded by this tool"));
    menu.appendChild(createMenuButton("📤 Load JSON", loadJSON, "Load from a previously saved JSON"));

    root_elem.appendChild(menu);
}

function createMenuButton(name, onclick, tooltip=null) {
    let button = document.createElement("input");
    button.type = "button";
    button.value = name;
    button.addEventListener("click", onclick);
    if (tooltip) {
        tippy(button, {
            content: tooltip,
            placement: "left",
            animation: "shift-away",
            arrow: true,
            theme: "light",
        });
    }
    return button;
}

function confirmDialog(title, text, confirmFunc) {
    swal({
        title: title,
        text: text,
        icon: "warning",
        buttons: true,
        dangerMode: true,
    }).then((confirm) => { if (confirm) { confirmFunc(); } });
}


////////// Saving Data //////////

/** Save the function planner data to local storage. */
function saveModel(major=false) {
    let str = JSON.stringify(model);
    localStorage.setItem(plan_name, str);
    if (major && previousModels.length === 0 || previousModels[previousModels.length - 1] !== str) {
        previousModels.push(str);
        if (previousModels.length > 1000) { previousModels.shift(); }
    }
    createCallGraph();
}

export function undo() {
    // get the most recent model that is not the current model
    let str = previousModels.pop();
    let cur = JSON.stringify(model);
    if (str === cur) { str = previousModels.pop(); }
    if (str === undefined) { return; }

    // load the model
    model = JSON.parse(str);
    saveModel();
    functions_elem.innerHTML = "";
    loadModel();
}

function updateFunctionName(func, name, major=false) {
    func.name = name;
    updateFuncNames();
    saveModel(major);
}

function saveParams(func, table, major=false) {
    func.params = [];
    for (let row of table.rows) {
        if (row.className === "header") { continue; }
        let type = row.cells[0].firstChild.value;
        let name = row.cells[1].firstChild.value.trim();
        let desc = row.cells[2].firstChild.value.trim();
        func.params.push({"type": type, "name": name, "desc": desc});
    }
    saveModel(major);
}

function saveReturns(func, table, major=false) {
    func.returns = [];
    for (let row of table.rows) {
        if (row.className === "header") { continue; }
        let type = row.cells[0].firstChild.value;
        let desc = row.cells[1].firstChild.value.trim();
        func.returns.push({"type": type, "desc": desc});
    }
    saveModel(major);
}

function updateFunctionCalls(func, table) {
    func.calls = [];
    for (let row of table.rows) {
        if (row.className === "header") { continue; }
        let call = row.cells[0].firstChild.value;
        func.calls.push(call);
    }
}

function saveFunctionCalls(func, table, major=false) {
    updateFunctionCalls(func, table);
    saveModel(major);
}


////////// Add Params, Returns, and Calls to a Function //////////

function addCell(row, element) {
    let newCell = document.createElement("td");
    newCell.appendChild(element);
    row.appendChild(newCell);
}

function addTypeCell(row, callback, locked=false) {
    let type = document.createElement("select");
    type.addEventListener("change", callback);
    for (let t of allowed_types) {
        let option = document.createElement("option");
        option.value = t;
        option.text = t;
        type.appendChild(option);
    }
    type.disabled = locked;
    addCell(row, type);
}

function addDescCell(row, callback, locked=false) {
    let desc = document.createElement("input");
    desc.addEventListener("input", () => callback(false));
    desc.addEventListener("blur", () => callback(true));
    desc.required = true;
    desc.readOnly = locked;
    addCell(row, desc);
}

function addRemoveButton(row, callback, locked=false) {
    if (locked) { addCell(row, document.createElement("span")); return; }
    let removeButton = document.createElement("input");
    removeButton.type = "button";
    removeButton.value = "X";
    removeButton.addEventListener("click", () => { row.parentElement.removeChild(row); callback(); });
    addCell(row, removeButton);
}

function addParameter(func, table, locked=false) {
    let row = document.createElement("tr");
    addTypeCell(row, () => saveParams(func, table, true), locked);
    let name = document.createElement("input");
    name.addEventListener("input", () => saveParams(func, table));
    name.addEventListener("blur", () => saveParams(func, table, true));
    name.required = true;
    name.pattern = "[a-zA-Z_][a-zA-Z0-9_]*";
    name.readOnly = locked;
    addCell(row, name);
    addDescCell(row, (major) => saveParams(func, table, major), locked);
    addRemoveButton(row, () => saveParams(func, table, true), locked);
    table.appendChild(row);
    saveParams(func, table);
}

function addReturnValue(func, table, locked=false) {
    let row = document.createElement("tr");
    addTypeCell(row, () => saveReturns(func, table, true), locked);
    addDescCell(row, (major) => saveReturns(func, table, major), locked);
    addRemoveButton(row, () => saveReturns(func, table, true), locked);
    table.appendChild(row);
    saveReturns(func, table);
}

function addFunctionCall(func, table, locked=false) {
    let row = document.createElement("tr");
    let call = document.createElement("select");
    let names = getFuncNames();
    for (let name of names) {
        let option = document.createElement("option");
        option.value = name;
        option.text = name;
        call.appendChild(option);
    }
    call.disabled = locked;
    if (!locked) { call.addEventListener("change", () => saveFunctionCalls(func, table, true)); }
    addCell(row, call);
    addRemoveButton(row, () => saveFunctionCalls(func, table, true), locked);
    table.appendChild(row);
    saveFunctionCalls(func, table);
}

function getFuncNames() { return model.map((func, i) => func.name || `function${i}`); }

/** Update the function names in the dropdowns. */
function updateFuncNames() {
    let names = getFuncNames();
    let dropdowns = functions_elem.querySelectorAll(".calls select");
    for (let dropdown of dropdowns) {
        let options = dropdown.options;
        for (let i = 0; i < Math.min(options.length, names.length); i++) {
            options[i].text = names[i];
            options[i].value = names[i];
        }
        if (options.length < names.length) {
            for (let i = options.length; i < names.length; i++) {
                let option = document.createElement("option");
                option.text = names[i];
                option.value = names[i];
                dropdown.appendChild(option);
            }
        } else if (options.length > names.length) {
            for (let i = options.length - 1; i >= names.length; i--) {
                dropdown.removeChild(options[i]);
            }
        }

        let funcElem = getParentByClass(dropdown, "function");
        let i = Array.prototype.indexOf.call(funcElem.parentElement.children, funcElem);
        updateFunctionCalls(model[i], getParentByTag(dropdown, "TABLE"));
    }
}


////////// Create Function Boxes //////////

function createSectionHeader(title, createFunc, locked=false) {
    let h3 = document.createElement("h3");
    h3.textContent = title + " ";
    if (!locked) {
        let button = document.createElement("input");
        button.type = "button";
        button.value = "+";
        button.addEventListener("click", createFunc);
        h3.appendChild(button);
    }
    return h3;
}

function createTableSection(name, title, table, createFunc, locked=false) {
    let div = document.createElement("div");
    div.className = name;
    div.appendChild(createSectionHeader(title, createFunc, locked));
    div.appendChild(table);
    return div;
}

function loadTable(table, func, name, keys, addFunc, locked=false) {
    let data = func[name] || [];
    for (let item of data) {
        addFunc(func, table, locked);
        let row = table.rows[table.rows.length - 1];
        if (keys === null) {
            row.cells[0].firstChild.value = item;
        } else {
            for (let i = 0; i < keys.length; i++) {
                row.cells[i].firstChild.value = item[keys[i]];
            }
        }
    }
}

function createTable(func, name, headers, keys, addFunc, saveFunc, locked=false) {
    let table = document.createElement("table");
    let header = document.createElement("tr");
    header.className = "header";
    for (let h of headers) {
        let th = document.createElement("th");
        th.textContent = h;
        header.appendChild(th);
    }
    table.appendChild(header);
    loadTable(table, func, name, keys, addFunc, locked);
    saveFunc(func, table);
    return table;
}

function createFunctionParams(func, locked=false) {
    let table = createTable(func, "params", ["Type", "Name", "Description"], ["type", "name", "desc"], addParameter, saveParams, locked);
    return createTableSection("params", "Parameter(s)", table, () => addParameter(func, table), locked);
}

function createFunctionReturns(func, locked=false) {
    let table = createTable(func, "returns", ["Type", "Description"], ["type", "desc"], addReturnValue, saveReturns, locked);
    return createTableSection("returns", "Return Value(s)", table, () => addReturnValue(func, table), locked);
}

function createFunctionCalls(func, locked=false) {
    let table = document.createElement("table");
    loadTable(table, func, "calls", null, addFunctionCall, locked);
    return createTableSection("calls", "Programmer-Defined Function Call(s)", table, () => addFunctionCall(func, table), locked);
}

function createDropdown(func, name, options, locked=false) {
    let label = document.createElement("label");
    let span = document.createElement("span");
    span.textContent = `User ${name}: `;
    label.appendChild(span);

    let dropdown = document.createElement("select");
    for (let [name, value] of Object.entries(options)) {
        let opt = document.createElement("option");
        opt.text = name;
        opt.value = value;
        dropdown.appendChild(opt);
    }
    dropdown.addEventListener("change", () => { func[name] = dropdown.value; saveModel(true); });
    dropdown.value = func[name] || Object.values(options)[0];
    dropdown.disabled = locked;
    label.appendChild(dropdown);

    return label;
}

function getParentByTag(elem, tag) {
    tag = tag.toUpperCase();
    while (elem = elem.parentNode) if (elem.tagName === tag) return elem;
}

function getParentByClass(elem, cls) {
    while (elem = elem.parentNode) if (elem.classList.contains(cls)) return elem;
}

function removeFunction(func, funcElem) {
    // remove the function itself (from the HTML and the model)
    funcElem.parentElement.removeChild(funcElem);
    let index = model.indexOf(func);
    let name = func.name || `function${index}`;
    model.splice(index, 1);

    // remove all calls to the function from other functions
    for (let i = 0; i < model.length; i++) {
        let calls = model[i].calls;
        if (!calls) { continue; }
        model[i].calls = calls.filter(call => call !== name);
    }
    for (let elem of functions_elem.querySelectorAll(".calls select")) {
        if (elem.selectedIndex === index) { getParentByTag(elem, "TR").remove(); }
        else { elem.remove(index); }
    }

    // remove the function name from all remaining dropdowns
    // updateFuncNames();

    // save the model
    saveModel(true);
}

function minimizeFunction(func, funcElem) {
    let button = funcElem.querySelector(".minimize");
    funcElem.classList.toggle("minimized"); 
    let minimized = funcElem.classList.contains("minimized");
    button.value = minimized ? "▲" : "▼";
    func.minimized = minimized;
    saveModel();
}

function addFunction(func={}) {
    let funcName = (func.name || "").trim();
    let locked = func.locked === true;

    // Create the function element
    let funcElem = document.createElement("div");
    funcElem.className = "function";
    if (locked) { funcElem.classList.add("locked"); }
    functions_elem.appendChild(funcElem);

    // Function Name
    let h2 = document.createElement("h2");
    let name = document.createElement("input");
    name.type = "text";
    name.value = funcName;
    name.className = "func_name";
    name.placeholder = "Function Name";
    name.required = true;
    name.pattern = "[a-zA-Z_][a-zA-Z0-9_]*";
    name.readOnly = locked;
    name.addEventListener("input", () => updateFunctionName(func, name.value.trim()));
    name.addEventListener("blur", () => updateFunctionName(func, name.value.trim(), true));
    h2.appendChild(name);
    funcElem.appendChild(h2);

    // Remove Button
    if (!locked) {
        let removeButton = document.createElement("input");
        removeButton.type = "button";
        removeButton.value = "X";
        removeButton.addEventListener("click", () => {
            confirmDialog("Remove Function?", "Are you sure you want to remove this function?",
                () => removeFunction(func, funcElem));
        });
        h2.appendChild(removeButton);
    }

    // Minimize Button
    let minimizeButton = document.createElement("input");
    minimizeButton.type = "button";
    minimizeButton.value = "▼";
    minimizeButton.className = "minimize";
    minimizeButton.addEventListener("click", () => minimizeFunction(func, funcElem));
    h2.appendChild(minimizeButton);

    // Function Description
    let desc = document.createElement("textarea");
    desc.className = "func_desc";
    desc.required = true;
    desc.placeholder = "Description";
    desc.readOnly = locked;
    desc.value = (func.desc || "").trim();
    desc.addEventListener("input", () => { func.desc = desc.value.trim(); saveModel(); });
    desc.addEventListener("blur", () => { func.desc = desc.value.trim(); saveModel(true); });
    funcElem.appendChild(desc);

    // Create the parameter, return, and call sections
    funcElem.appendChild(createFunctionParams(func, locked));
    funcElem.appendChild(createFunctionReturns(func, locked));
    funcElem.appendChild(createFunctionCalls(func, locked));

    // Create user input/output section
    funcElem.appendChild(createDropdown(func, "input",
        {"none": "none", "indirect": "indirect", "direct, no validation": "direct", "direct, requires validation": "validation"},
        locked));
    funcElem.appendChild(createDropdown(func, "output",
        {"none": "none", "indirect": "indirect", "direct": "direct"}, locked));

    // Create the testable checkbox
    let testable = document.createElement("label");
    let span = document.createElement("span");
    span.textContent = "Testable: ";
    testable.appendChild(span);
    let checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "testable";
    checkbox.addEventListener("change", () => { func.testable = checkbox.checked; saveModel(true); });
    checkbox.checked = func.testable === true;
    checkbox.disabled = locked;
    testable.appendChild(checkbox);
    funcElem.appendChild(testable);

    // Update the function name in the dropdowns
    updateFunctionName(func, funcName);
    if (func.minimized === true) { minimizeFunction(func, funcElem); }

    return funcElem;
}

export function addNewFunction() {
    let func = {};
    model.push(func);
    let funcElem = addFunction(func);
    saveModel(true);
    return funcElem;
}

/** Load all of the functions from the model. */
function loadModel() {
    loading = true;
    for (const func of model) { addFunction(func); }
    loading = false;
}


////////// Exporting Data //////////

/**
 * Export the list of items to a string. Each item is formatted by the formatItem function.
 */
function exportList(name, list, formatItem) {
    let text = `${name}: `;
    if (list === null || list.length === 0) {
        text += "none";
    } else if (list.length === 1) {
        text += formatItem(list[0], 0);
    } else {
        for (let [i, item] of list.entries()) { text += `\n    ${formatItem(item, i)}`; }
    }
    text += "\n";
    return text;
}

/** Copy the given text to the clipboard. */
function copyToClipboard(text) {
    let textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
}

/**
 * Export the function planner data for pasting into the functions.txt file of the lab.
 */
 export function exportToText() {
    let text = "Teammate Names: \n\nFunctions\n=========\n\n";
    for (const [i, func] of model.entries()) {
        let name = func.name || `function${i}`;
        text += `${name}\n`;
        for (let j = 0; j < name.length; j++) { text += "-"; }
        let desc = func.desc || "";
        if (desc) { text += `\n${desc}\n\n`; } else { text += "\n"; }
        let params = func.params || [];
        // TODO: handle missing names and types
        text += exportList("Parameters", params, (p, i) => `${p.type} - ${p.name || letter(i)} - ${p.desc}`);
        let returns = func.returns || [];
        text += exportList("Returns", returns, (ret, i) => `${ret.type} - ${ret.desc}`);
        let calls = func.calls || [];
        text += "\n";
        text += exportList("Calls", calls, call => call);
        text += "\n";
        text += `User Input: ${func.input || "none"}\n`;
        text += `User Output: ${func.output || "none"}\n\n`;
        text += `Testable: ${func.testable === true ? "yes" : "no"}\n\n`;
    }
    copyToClipboard(text);
    swal({
        title: "Text Copied",
        text: "Text copied to clipboard. Paste it into functions.txt.",
        icon: "success",
        button: "OK",
    });
}

function typeToPython(type) {
    if (type.startsWith("list of ")) { return `list[${typeToPython(type.slice(8))}]`; }
    if (type.startsWith("tuple of ")) { return `tuple[${typeToPython(type.slice(9))}]`; }
    // TODO: support dictionaries and possibly other types
    return type;
}

function defaultReturnValue(type) {
    // TODO: handle more types
    if (type === "int") { return "0"; }
    if (type === "str") { return '""'; }
    if (type === "float") { return "0.0"; }
    if (type === "bool") { return "False"; }
    if (type.startsWith("list of ")) { return `[${defaultReturnValue(type.slice(8))}]`; }
    if (type.startsWith("tuple of ")) { return `(${defaultReturnValue(type.slice(9))},)`; }
    return "None";
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

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function letter(n) { return ALPHABET.charAt(n % ALPHABET.length); }

function getParam(param, i, withTypes=true) {
    let name = (param.name || letter(i)).trim();
    if (!withTypes || !param.type) { return name; }
    return `${name}: ${typeToPython(param.type)}`;
}

function pythonDefLine(name, params, returns, withTypes=true) {
    let paramsDef = params.map((p, i) => getParam(p, i, withTypes));
    let returnDef = "";
    if (withTypes && returns.length > 0) {
        let returnTypes = returns.map(ret => typeToPython(ret.type));
        returnDef = " -> " + ((returns.length === 1) ? returnTypes[0] : `tuple[${returnTypes.join(", ")}]`);
    }
    return `def ${name}(${paramsDef.join(", ")})${returnDef}:`;
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
    // TODO: make this more official
    let docstring = `    """\n${wrapText(desc)}\n`;
    docstring += formatListInDocstring("Parameter", params, (p, i) => `${p.name || letter(i)} (${p.type}): ${p.desc}`);
    docstring += formatListInDocstring("Return", returns, (ret, i) => `${ret.type}: ${ret.desc}`);
    docstring += `    """\n`;
    return docstring;
}

export function exportToPython(withTypes=true) {
    let text = '"""\nTODO: program header\n\nAuthor names:\n"""\n\n';
    let hasMain = false;
    for (const [i, func] of model.entries()) {
        // Create the def line
        let name = func.name || `function${i}`;
        if (name === "main") { hasMain = true; }
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
            let calls = func.calls || [];
            if (calls.length > 0) { funcText += `    # Calls ${calls.map(call => call + "()").join(", ")}\n`; }
            let input = func.input || "none";
            if (input === "direct") { funcText += `    # Has direct user input\n`; }
            else if (input === "validation") { funcText += `    # Has direct user input that requires validation\n`; }
            let output = func.output || "none";
            if (output === "direct") { funcText += `    # Has direct user output\n`; }

            // Dummy return statement
            if (returns.length > 0) {
                funcText += `    return ${returns.map(ret => defaultReturnValue(ret.type)).join(", ")}`;
            } else {
                funcText += "    pass";
            }
        }

        text += funcText + "\n\n\n";
    }
    if (hasMain) {
        text += 'if __name__ == "__main__":\n    main()\n';
    }

    copyToClipboard(text);
    swal({
        title: "Text Copied",
        text: "Text copied to clipboard. Paste it into a Python file.",
        icon: "success",
        button: "OK",
    });
}


////////// Clearing/Reseting Data //////////

export function clearPlan(confirm = true) {
    if (model.length === 0) { return; }
    if (confirm) {
        confirmDialog("Clear Plan?", "Are you sure you want to clear this plan?",
            () => { clearPlan(false); });
    } else {
        saveModel(true);
        callgraph_elem.innerHTML = "";
        functions_elem.innerHTML = "";
        model = [];
        localStorage.setItem(plan_name, "[]");
    }
}

export function loadDefaultPlan(confirm = true) {
    if (confirm) {
        confirmDialog("Load Defaults?", "Are you sure you want to load the default functions for this plan? This will clear the current plan.",
            () => { loadDefaultPlan(false); });
    } else {
        clearPlan(false);
        model = JSON.parse(JSON.stringify(default_model));
        loadModel();
        saveModel(true);
    }
}

export function saveJSON() {
    let text = JSON.stringify(model, null, 4);
    copyToClipboard(text);
    swal({
        title: "JSON Copied",
        text: "JSON copied to clipboard. Save to a file so it can be reloaded later.",
        icon: "success",
        button: "OK",
    });
}

export function loadJSON() {
    swal({
        title: "Load JSON",
        text: "Paste the JSON data below. This will overwrite the current plan.",
        content: "input",
        buttons: true,
    }).then((value) => {
        if (value === null) { return; }
        try {
            model = JSON.parse(value);
            functions_elem.innerHTML = "";
            loadModel();
            saveModel(true);
        } catch (e) {
            swal("Invalid JSON", "The JSON data is invalid.", "error");
        }
    });
}


////////// Checks and Callgraph //////////

export function performBasicChecks(min_funcs=0, min_testable=0) {
    // Check that there are a minimum number of functions in total
    if (model.length < min_funcs) { checkError(`There must be at least ${min_funcs} functions.`); return; }

    // Check that all functions have a valid name
    let functionNames = model.map(func => (func.name || "").trim());
    for (let name of functionNames) {
        if (name === "") {
            checkError(`Function ${i+1} has no name.`);
            return;
        } else if (!name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
            checkError(`Function ${i+1} has an invalid name ("${name}").`);
            return;
        }
    }

    // Check that there are no duplicate function names
    let uniqueNames = new Set(functionNames);
    if (uniqueNames.size < functionNames.length) { checkError("There are duplicate function names."); return; }

    // Check that there is a main function
    if (!functionNames.includes("main")) { checkError("There must be a main() function."); return; }

    // Check that main has no parameters and no return values
    let mainIndex = functionNames.indexOf("main");
    let mainParams = model[mainIndex].params || [];
    if (mainParams.length > 0) { checkError("main() must have no parameters."); return; }
    let mainReturns = model[mainIndex].returns || [];
    if (mainReturns.length > 0) { checkError("main() must have no return values."); return; }

    // Check that no function calls itself
    for (let func of model) {
        let calls = func.calls || [];
        if (calls.includes(func.name)) { checkError(`${func.name} calls itself.`); return; }
    }

    // Check that no function calls the same function more than once
    for (let func of model) {
        let calls = func.calls || [];
        let uniqueCalls = new Set(calls);
        if (uniqueCalls.size < calls.length) {
            checkError(`${func.name} "calls" the same function more than once (even if it will call it more than once, just list is once here).`);
            return;
        }
    }

    // Check that all functions except main are called by at least one other function (and check that main is not called by any other function
    let callGraph = {};
    for (let func of model) { callGraph[func.name] = func.calls || []; }
    for (let func of model) {
        let name = func.name;
        let found = false;
        for (let func2 of model) {
            if (name !== func2.name && callGraph[func2.name].includes(name)) {
                found = true;
                break;
            }
        }
        if (!found && name !== "main") {
            checkError(`${name}() is not called by any other function.`);
            return;
        } else if (found && name === "main") {
            checkError("main() should not be called by another function.");
            return;
        }
    }

    // Check that there are no cycles in the function calls
    let visited = new Set();
    let stack = [];
    let dfs = function(name) {
        if (visited.has(name)) { return; }
        visited.add(name);
        stack.push(name);
        for (let call of callGraph[name]) {
            if (stack.includes(call)) {
                checkError(`There is a cycle in the function calls involving ${call}().`);
                return;
            }
            dfs(call);
        }
        stack.pop();
    }
    dfs("main");

    // Check that all functions except main have a description
    for (let func of model) {
        let name = func.name;
        if (name === "main") { continue; }
        let desc = (func.desc || "").trim();
        if (desc.length === 0) {
            checkError(`${name} has no description.`);
            return;
        } else if (desc.length < 20) {
            checkError(`${name} description is too short - be more descriptive!`);
            return;
        }
    }

    // Check that all testable functions have no user input or output, at least one parameter, and at least one return value
    let testableCount = 0;
    for (let func of model) {
        let name = func.name;
        let testable = func.testable === true;
        if (testable) { testableCount++; }
        let input = func.input || "none";
        let output = func.output || "none";
        if (testable && (input !== "none" || output !== "none")) {
            checkError(`We cannot test functions that have user input or output, but you marked otherwise for ${name}().`);
            return;
        }
        let params = func.params || [];
        if (testable && params.length === 0) {
            checkError(`We cannot test functions that have no parameters, but you marked otherwise for ${name}(). Should it have at least one parameter?`);
            return;
        }
        let returns = func.returns || [];
        if (testable && returns.length === 0) {
            checkError(`We cannot test functions that have no return values, but you marked otherwise for ${name}(). Should it have at least one return value?`);
            return;
        }
    }
    if (testableCount < min_testable) {
        checkError(`There must be at least ${min_testable} testable functions.`);
        return;
    }

    // Check that a function that calls another function that has user input/output also has user input/output
    for (let func of model) {
        let calls = func.calls || [];
        for (let call of calls) {
            let called = model[functionNames.indexOf(call)];
            if (!__checkIO(func, called, "input")) { return; }
            if (!__checkIO(func, called, "output")) { return; }
        }
    }

    // Check that main has only indirect user input/output
    if (model[mainIndex].output !== "indirect" || model[mainIndex].input !== "indirect") {
        checkError("main() should only have indirect user input/output.");
        return;
    }

    // Success!
    swal({
        title: "Passed!",
        text: "All basic checks passed!",
        icon: "success",
        button: "OK",
    });
}

function __checkIO(func, called, kind) {
    let called_kind = called[kind] || "none";
    let func_kind = func[kind] || "none";
    if (called_kind !== "none" && func_kind === "none") {
        checkError(`${func.name}() calls ${called.name}(), which has user ${kind}, but ${func.name}() does not have user ${kind} (it should at least be marked as indirect).`);
        return false;
    }
    return true;
}

function checkError(text) {
    swal({
        title: "Error",
        text: text,
        icon: "error",
        button: "OK",
    });
}


let loading = false;
let lastDiagram = null;

let PLAIN_STYLE = "fill:#ddd";
let TESTABLE_STYLE = "fill:#090";
let INPUT_NO_VALID_STYLE = "fill:#f90";
let INPUT_VALIDATION_STYLE = "fill:#f60";
let OUTPUT_ONLY_STYLE = "fill:#09f";

export function createCallGraph() {
    // TODO: auto-refresh is obnoxious (due to resizing and similar issues)
    if (model.length === 0 || loading) { callgraph_elem.innerHTML = ""; return; }
    //callgraph_elem.innerHTML = "";

    try {
        let funcNameInputs = Array.from(functions_elem.querySelectorAll(".function input.func_name"));

        let code = "%%{init: {'theme':'neutral'}}%%\nflowchart TD\n";
        let links = "";
        let nodeNames = new Set();
        for (let [i, func] of model.entries()) {
            // Create the node for the function
            let name = func.name || `function${i}`;
            let nodeName = name.replace(/[^a-zA-Z0-9_]/g, "");
            let displayName = name.replace(/"'\[\]\\/g, "");
            while (nodeNames.has(nodeName)) { nodeName += "_"; }
            nodeNames.add(nodeName);
            code += `    ${nodeName}["${displayName}()"];\n`;

            // Set the style for the node
            let style = PLAIN_STYLE;
            if (func.testable === true) { style = TESTABLE_STYLE; }
            else if (func.input === "validation") { style = INPUT_VALIDATION_STYLE; }
            else if (func.input === "direct") { style = INPUT_NO_VALID_STYLE; }
            else if (func.output === "direct") { style = OUTPUT_ONLY_STYLE; }
            if (style) { code += `    style ${nodeName} ${style}\n`; }

            // Create the links to the function calls
            let calls = func.calls || [];
            for (let call of calls) { links += `    ${nodeName} --> ${call};\n`; }

            // Create the link to the function definition
            let funcElem = funcNameInputs[i].parentElement.parentElement;
            funcElem.id = nodeName;
            let tooltip = pythonDefLine(displayName, func.params, func.returns);
            tooltip = tooltip.replace(/^def /, "").replace(/:$/, "").replace(/"/, "'");
            code += `    click ${nodeName} href "#${nodeName}" "${tooltip}"\n`;
        }
        code += links;
        if (code === lastDiagram) { return; }
        console.log(code);
        lastDiagram = code;
        __drawDiagram(code);
    } catch (e) {
        console.error(e);
        callgraph_elem.innerHTML = "";
    }
}

async function __drawDiagram(code) {
    const { svg, bindFunctions } = await mermaid.render("flowchart", code);
    callgraph_elem.innerHTML = svg;
    if (bindFunctions) { bindFunctions(callgraph_elem); }
}
