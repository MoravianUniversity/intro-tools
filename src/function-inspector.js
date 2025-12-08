/**
 * Functions for setting up and managing the function inspector panel.
 */

import Sortable from 'sortablejs';
import Swal from 'sweetalert2';

import { wrapWithLabel, makeCheckbox, makeTextarea, makeCodeEditorWithShowCheckbox, makeReadOnlySelect, updateProblemsInInspector, isReadOnly } from './inspector.js';
import { funcProblems, linkProblems, funcLinkProblems, funcIOProblemsUpdateParents, modelProblems } from './problem-checker.js';
import { loadSVG, makeOption } from './utils.js';

import TypeEditor from './type-editor.js';

export function showFunctionInspector(diagram, inspectorDiv, node) {
    const data = node.data;

    function updateProblems(fix = false, key = null) {
        // get the problems for this function
        const problems = funcProblems(data, diagram, fix);
        if (key === 'name') { // recheck the link problems since "main" is special   
            diagram.model.setDataProperty(data, 'linkProblems', funcLinkProblems(node));
            for (const link of node.findLinksConnected()) {
                diagram.model.setDataProperty(link.data, 'linkProblems', linkProblems(link));
            }
        }
        if (key === 'name' || key === 'testable') {  // recheck the model problems since it counts the number of testable functions and if there is a "main"
            modelProblems(diagram);
        }
        if (key === 'io') {  // recheck the parent's io problems due to indirect/none
            funcIOProblemsUpdateParents(diagram.findNodeForData(data));
        }
        diagram.model.setDataProperty(data, 'problems', problems);

        // update the inspector
        const allProbs = problems.concat(data.linkProblems || []);
        updateProblemsInInspector(inspectorDiv, allProbs);
    }

    function setValue(key, value, fix=false) {
        diagram.model.setDataProperty(data, key, value);
        updateProblems(fix, key);
    }

    // set a value (for one-shot values)
    function set(key, value) {
        diagram.commit((d) => { if (data[key] !== value) { setValue(key, value, true); } }, `${key} changed`);
    }

    // update and commit a transaction (for multi-step changes)
    let currentTransaction = null;
    function update(key, value, fix=false) {
        if (data[key] !== value || fix) {
            // make sure there is a transaction in progress
            if (currentTransaction !== key) {
                if (currentTransaction) { diagram.commitTransaction(`${currentTransaction} changed`); }
                diagram.startTransaction(`${key} changed`);
                currentTransaction = key;
            }

            // update the value
            setValue(key, value, fix);
        }
    }
    function end(key, value) {
        update(key, value, true);
        // commit the transaction
        if (currentTransaction === key) {
            diagram.commitTransaction(`${key} changed`);
            currentTransaction = null;
        }
    }

    inspectorDiv.innerHTML = '';
    inspectorDiv.classList.toggle('is-main', data.name === 'main');
    inspectorDiv.appendChild(makeFuncName(diagram, data, update, end, inspectorDiv));
    inspectorDiv.appendChild(makeFuncDesc(diagram, data, update, end));
    inspectorDiv.appendChild(makeParams(diagram, data, update, end));
    inspectorDiv.appendChild(makeReturns(diagram, data, update, end));
    inspectorDiv.appendChild(makeIOSelect(diagram, data, set));
    inspectorDiv.appendChild(makeTestableCheckbox(diagram, data, set));
    if (diagram.adminMode) {
        inspectorDiv.appendChild(makeReadOnlySelect(diagram, data, set,
            ['name', 'params', 'returns', 'desc', 'io', 'testable', 'code', 'testCode', 'calls', 'callsInto', 'callsOutOf']));
    }
    const problemsDiv = document.createElement('div');
    problemsDiv.className = 'problems';
    inspectorDiv.appendChild(problemsDiv);
    updateProblems();
    makeCodeEditorWithShowCheckbox(inspectorDiv, diagram, data, 'code', update, end, set,
        'Function Code', '# Write your function code here\n');
    makeCodeEditorWithShowCheckbox(inspectorDiv, diagram, data, 'testCode', update, end, set,
        'Test Code', '# Write your test code here\n');
}

function makeFuncName(diagram, data, update, end, inspectorDiv) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'func-name';
    input.placeholder = 'Function Name';
    input.required = true;
    input.pattern = '[a-zA-Z_][a-zA-Z0-9_]*';
    input.value = data.name || '';
    input.readOnly = !diagram.adminMode && isReadOnly(data, 'name');

    input.addEventListener('input', (e) => {
        inspectorDiv.classList.toggle('is-main', e.target.value.trim() === 'main');
        update('name', createValidIdentifier(e.target.value));
    });
    input.addEventListener('blur', (e) => {
        inspectorDiv.classList.toggle('is-main', e.target.value.trim() === 'main');
        end('name', createValidIdentifier(e.target.value));
    });

    const h2 = document.createElement('h2');
    h2.appendChild(input);
    return h2;
}
function makeFuncDesc(diagram, data, update, end) {
    const textarea = makeTextarea(diagram, data, 'desc', update, end, 'Description');
    textarea.required = true;
    return textarea;
}
function createValidIdentifier(name) {
    if (name.includes('(')) { name = name.split('(')[0]; }
    return name.trim().replace(/[^a-zA-Z0-9_]/g, '_');
}
function makeIOSelect(diagram, data, set) {
    const select = document.createElement('select');
    select.className = 'func-io';
    select.disabled = !diagram.adminMode && isReadOnly(data, 'io');

    const options = [
        { value: 'none', text: 'None' },
        { value: 'indirect', text: 'Indirect I/O' },
        { value: 'output', text: 'Output Only' },
        { value: 'input', text: 'Basic Input' },
        { value: 'validation', text: 'Validated Input' }
    ];

    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.text;
        if (data.io === opt.value) { option.selected = true; }
        select.appendChild(option);
    });

    select.addEventListener('change', (e) => { set('io', e.target.value); });

    return wrapWithLabel(select, 'User I/O: ');
}
function makeTestableCheckbox(diagram, data, set) {
    return wrapWithLabel(makeCheckbox(diagram, data, 'testable', set), 'Testable: ');
}

function makeParams(diagram, data, update, end) {
    return createVarsBox(diagram, "Parameter", "params", data, update, end, saveParams, makeParam);
}
function makeParam(diagram, data, save, index=-1) {
    const pData = (index >= 0) ? data.params[index] : { name: '', type: '', desc: '' };
    const ro = !diagram.adminMode && (isReadOnly(data, 'params') || isReadOnly(data, `params.${pData.name}`) || isReadOnly(data, `params.${index}`));
    return createVarBox(diagram, pData, ro, () => makeParam(diagram, data, save), save);
}
function saveParams(div, update, end, major=false) {
    const params = [];
    for (const param of div.getElementsByClassName("func-var")) {
        const name = param.getElementsByClassName("func-var-name")[0].value;
        const type = param.getElementsByClassName("func-var-type")[0].value;
        const desc = param.getElementsByClassName("func-var-desc")[0].value;
        params.push({ name, type, desc });
    }
    if (major) { end('params', params); }
    else { update('params', params); }

}

function makeReturns(diagram, data, update, end) {
    return createVarsBox(diagram, "Return", "returns", data, update, end, saveReturns, makeReturn);
}
function makeReturn(diagram, data, save, index=-1) {
    const rData = (index >= 0) ? data.returns[index] : { type: '', desc: '' };
    const ro = !diagram.adminMode && (isReadOnly(data, 'returns') || isReadOnly(data, `returns.${index}`));
    return createVarBox(diagram, rData, ro, () => makeReturn(diagram, data, save), save);
}
function saveReturns(div, update, end, major=false) {
    const returns = [];
    for (const ret of div.getElementsByClassName("func-var")) {
        const type = ret.getElementsByClassName("func-var-type")[0].value;
        const desc = ret.getElementsByClassName("func-var-desc")[0].value;
        returns.push({ type, desc });
    }
    if (major) { end('returns', returns); }
    else { update('returns', returns); }
}

function createSectionHeader(title) {
    let h3 = document.createElement("h3");
    h3.textContent = title;
    return h3;
}
function createVarsBox(diagram, name, field, data, update, end, saveVar, makeVar) {
    const div = document.createElement("div");
    div.className = `func-${field} func-vars`;
    const list = document.createElement("div");

    function save(major=false) { saveVar(list, update, end, major); }
    function make(index=-1) { list.appendChild(makeVar(diagram, data, save, index)); }

    div.appendChild(createSectionHeader(name+"(s)"));
    const ro = !diagram.adminMode && isReadOnly(data, field);
    addAddButton(div, () => { make(); save(true); }, ro);
    div.appendChild(list);
    for (const index of (data[field] || []).keys()) { make(index); }
    // save();
    if (!ro) {
        Sortable.create(list, {
            group: field,
            handle: '.func-var-drag-handle',
            filter: '.func-var-drag-disabled',
            direction: 'vertical',
            onUpdate: () => save(true),
        });
    }
    return div;
}
function createVarBox(diagram, data, ro, make, save) {
    const box = document.createElement("div");
    box.className = "func-var";
    addDragHandle(box, () => { save(true); }, ro);
    addAddButton(box, () => { box.before(make()); save(true); }, ro);
    addRemoveButton(box, () => save(true), ro);
    if (data.hasOwnProperty('name')) {
        addNameElement(box, data.name || '', (major) => save(major), ro);
        box.appendChild(document.createElement("span")).appendChild(document.createTextNode(" : "));
    }
    addTypeElement(diagram, box, data.type || '', () => save(true), ro);
    addDescElement(box, data.desc || '', (major) => save(major), ro);
    return box;
}
function addNameElement(elem, value, callback, locked=false) {
    const name = document.createElement("input");
    name.addEventListener("input", () => callback(false));
    name.addEventListener("blur", () => callback(true));
    name.type = "text";
    name.className = "func-var-name";
    name.placeholder = "name";
    name.required = true;
    name.pattern = "[a-zA-Z_][a-zA-Z0-9_]*";
    name.readOnly = locked;
    name.value = value || '';
    elem.appendChild(name);
}

////////// Type editor functions //////////
function getTypeText(type) {
    if (type === "list") { return "list of ..."; }
    if (type === "tuple") { return "tuple with ..."; }
    if (type === "dict") { return "dict with ..."; }
    if (type === "set") { return "set of ..."; }
    if (type === "custom") { return "custom..."; }
    return type;
}
function addCustomTypeOption(select, type) {
    const opt = makeOption(type);
    opt.customType = true;
    opt.setAttribute("data-custom-type", "true");
    select.options.add(opt);
}
function addCustomTypeOptionToAll(select, type) {
    const inspector = select.closest('.inspector');
    const allSelects = inspector ? inspector.querySelectorAll('select.func-var-type') : [select];
    for (const sel of allSelects) {
        addCustomTypeOption(sel, type);
    }
}
function setCustomTypeOption(select, type) {
    const matches = [...select.options].filter(opt => opt.value === type);
    if (matches.length === 0) {
        addCustomTypeOptionToAll(select, type);
    }
    select.value = type;
}
function addTypeElement(diagram, elem, value, callback, locked=false) {
    const holder = document.createElement("span");
    holder.className = "func-var-type-holder";
    elem.appendChild(holder);

    const select = document.createElement("select");

    select.addEventListener("change", async () => {
        if (select.selectedOptions[0].text.endsWith("...")) {
            const result = await showTypeBuilder(diagram, select.value);
            if (result === null) { select.value = select.lastSelected; return; }
            setCustomTypeOption(select, result);
        }
        callback();
    });
    select.appendChild(makeOption("", "type")); // blank option
    for (const t of diagram.allowedTypes) {
        select.appendChild(makeOption(t, getTypeText(t)));
    }
    const allSpecialTypes = new Set();
    for (const funcNode of diagram.nodes) {
        const all = (funcNode.data.returns || []).concat(funcNode.data.params || []).map(v => v.type)
            .filter(type => type && !diagram.allowedTypes.includes(type));
        for (const t of all) {
            allSpecialTypes.add(t);
        }
    }
    for (const t of allSpecialTypes) {
        addCustomTypeOption(select, t);
    }

    select.className = "func-var-type";
    if (value) {
        setCustomTypeOption(select, value);
        select.lastSelected = value;
    } else {
        select.value = "";
    }
    select.disabled = locked;
    holder.appendChild(select);

    if (!locked) {
        // edit button
        const button = document.createElement("button");
        button.type = "button";
        button.className = "func-var-type-edit";
        button.title = "Edit Type...";
        button.innerHTML = "&#9998;";
        button.addEventListener("click", async () => {
            const result = await showTypeBuilder(diagram, select.value);
            if (result !== null) {
                setCustomTypeOption(result);
                callback();
            }
        });
        holder.appendChild(button);
    }
}
async function showTypeBuilder(diagram, initialType) {
    let result = null;
    const returnValue = await Swal.fire({
        theme: diagram.themeManager.currentTheme,
        title: "Create Type",
        html: "<div class='func-planner-type-builder'></div>",
        showCancelButton: true,
        willOpen: (popup) => {
            const content = popup.querySelector('.func-planner-type-builder');
            function onChange(value) {
                if (!value.includes('?')) {
                    result = value;
                    Swal.getConfirmButton().disabled = false;
                } else {
                    Swal.getConfirmButton().disabled = true;
                }
            }
            const editor = new TypeEditor(content, {
                onChange, allowedTypes: diagram.allowedTypes, initialType: initialType.trim()
            });
        },
    });
    return returnValue.isConfirmed ? result : null;
}

// Other parts of a variable box
function addDescElement(elem, value, callback, locked=false) {
    let desc = document.createElement("input");
    desc.addEventListener("input", () => callback(false));
    desc.addEventListener("blur", () => callback(true));
    desc.type = "text";
    desc.className = "func-var-desc";
    desc.placeholder = "description";
    desc.required = true;
    desc.readOnly = locked;
    desc.value = value || '';
    elem.appendChild(desc);
}
function addDragHandle(elem, callback, locked=false) {
    if (locked) {
        elem.classList.add("func-var-drag-disabled");
        return;
    }
    const handle = document.createElement("div");
    handle.className = "func-var-drag-handle";
    elem.appendChild(handle);
}
function addVarButton(elem, name, callback, locked=false) {
    if (locked) { return; }
    const button = document.createElement("div");
    button.className = "func-var-button func-var-button-" + name;
    button.addEventListener("click", callback);
    loadSVG(`images/${name}.svg`, button, name === "remove" ? "x" : "+");
    elem.appendChild(button);
}
function addAddButton(elem, createFunc, locked=false) {
    addVarButton(elem, "add", createFunc, locked);
}
function addRemoveButton(elem, callback, locked=false) {
    addVarButton(elem, "remove", () => { elem.parentElement.removeChild(elem); callback(); }, locked);
}

