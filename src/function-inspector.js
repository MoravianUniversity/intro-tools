/**
 * Functions for setting up and managing the function inspector panel.
 */

import go from 'gojs';
import Sortable from 'sortablejs';
import Swal from 'sweetalert2';

import { funcProblems, linkProblems, funcLinkProblems, funcIOProblemsUpdateParents, modelProblems } from './problem-checker.js';
import { loadSVG, makeOption } from './utils.js';

import TypeEditor from './type-editor.js';

export function setupFunctionInspector(diagram) {
    const diagramDiv = diagram.div;
    const rootElem = diagramDiv.parentNode;

    const resizer = document.createElement('div');
    resizer.className = 'inspector-resizer';
    rootElem.appendChild(resizer);

    const inspectorDiv = document.createElement('div');
    inspectorDiv.className = 'inspector';
    inspectorDiv.innerHTML = 'TODO';
    rootElem.appendChild(inspectorDiv);

    const width = rootElem.clientWidth;
    const initialLeft = Math.min(width - 300, width * 0.8);
    diagramDiv.style.width = `${initialLeft}px`;
    resizer.style.left = `${initialLeft}px`;
    inspectorDiv.style.left = `${initialLeft + resizer.clientWidth}px`;

    function setX(x) {
        diagramDiv.style.width = `${x}px`;
        resizer.style.left = `${x}px`;
        inspectorDiv.style.left = `${x + resizer.clientWidth}px`;
    }

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const onMouseMove = (e) => {
            const rootElemX = rootElem.getBoundingClientRect().left;
            setX(Math.max(200, Math.min(e.clientX - rootElemX, rootElem.clientWidth - 200)));
        }
        const onMouseUp = () => {
            rootElem.removeEventListener('mousemove', onMouseMove);
            rootElem.removeEventListener('mouseup', onMouseUp);
        };
        rootElem.addEventListener('mousemove', onMouseMove);
        rootElem.addEventListener('mouseup', onMouseUp);
    });
    let lastWidth = width;
    const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
            let newWidth = entry.contentRect.width;
            if (newWidth !== lastWidth) {
                const curX = parseFloat(diagramDiv.style.width);
                setX(Math.max(200, Math.min(newWidth - 200, newWidth * curX / lastWidth)));
                lastWidth = newWidth;
            }
        }
    });
    resizeObserver.observe(rootElem);

    function inspectObject(node) {
        inspectorDiv.innerHTML = '';
        if (!node) { inspectorDiv.innerHTML = 'TODO'; return; }
        const problemsDiv = document.createElement('div');
        problemsDiv.className = 'problems';
        const data = node.data;

        function updateProblems(fix = false, key = null) {
            const problems = funcProblems(data, diagram, fix);
            for (const elem of Array.from(inspectorDiv.getElementsByClassName('error'))) { elem.classList.remove('error'); }
            for (const elem of Array.from(inspectorDiv.getElementsByClassName('warning'))) { elem.classList.remove('warning'); }
            for (const [type, fields, message] of problems) {
                for (const field of fields.split(',')) {
                    let elem;
                    if (field.includes("[")) {
                        // handle array-like fields (e.g., params[0].name)
                        const [baseField, rem] = field.split('[');
                        const [index, name_] = rem.split(']');
                        const name = name_.slice(1);
                        elem = inspectorDiv.getElementsByClassName(`func-${baseField}`)[0]
                            ?.getElementsByClassName(`func-var-${name}`)[index];
                    } else {
                        elem = inspectorDiv.getElementsByClassName(`func-${field}`)[0];
                    }
                    if (elem) { elem.classList.add(type); }
                }
            }
            diagram.model.setDataProperty(data, 'problems', problems);
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
            const allProbs = problems.concat(data.linkProblems || []);
            if (allProbs.length > 0) {
                problemsDiv.innerHTML = '<h3>Problems</h3><ul class="problems">' + 
                    allProbs.map(p => `<li class="${p[0]}">${p[2]}</li>`).join('') + '</ul>';
            } else {
                problemsDiv.innerHTML = '';
            }
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

        inspectorDiv.classList.toggle('is-main', data.name === 'main');
        inspectorDiv.appendChild(makeFuncName(diagram, data, update, end, inspectorDiv));
        inspectorDiv.appendChild(makeFuncDesc(diagram, data, update, end));
        inspectorDiv.appendChild(makeParams(diagram, data, update, end));
        inspectorDiv.appendChild(makeReturns(diagram, data, update, end));
        inspectorDiv.appendChild(makeIOSelect(diagram, data, set));
        inspectorDiv.appendChild(makeTestableCheckbox(diagram, data, set));
        updateProblems();
        inspectorDiv.appendChild(problemsDiv);
        if (data.showCode) {
            inspectorDiv.appendChild(makeCodeEditor(diagram, data, update, end));
        }
    }

    diagram.addDiagramListener('ChangedSelection', (e) => {
        let subject = e.subject.first();
        if (subject instanceof go.Link) {
            return; // keep same
            //subject = subject.fromNode; // show the fromNode of the link
            //inspectorDiv.innerHTML = 'TODO';
        }
        inspectObject(subject);
    });
}

function makeFuncName(diagram, data, update, end, inspectorDiv) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'func-name';
    input.placeholder = 'Function Name';
    input.required = true;
    input.pattern = '[a-zA-Z_][a-zA-Z0-9_]*';
    input.value = data.name || '';
    input.readOnly = isReadOnly(data, 'name');

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
    const textarea = makeTextarea(data, 'desc', update, end);
    textarea.placeholder = 'Description';
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
    select.disabled = isReadOnly(data, 'io');

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
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'func-testable';
    checkbox.checked = data.testable || false;
    checkbox.disabled = isReadOnly(data, 'testable');
    checkbox.addEventListener('change', (e) => { set('testable', e.target.checked); });
    return wrapWithLabel(checkbox, 'Testable: ');
}
function wrapWithLabel(elem, text) {
    const label = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = text;
    label.appendChild(span);
    label.appendChild(elem);
    return label;
}
function makeCodeEditor(diagram, data, update, end) {
    let textarea;
    if (isReadOnly(data, 'code') && typeof Prism !== 'undefined') {
        textarea = document.createElement('div');
        textarea.className = 'func-code language-python';
        textarea.innerHTML = Prism.highlight(data.code || '', Prism.languages.python, 'python');
    } else {
        textarea = makeTextarea(data, 'code', update, end);
        textarea.rows = data.code.trim().split('\n').length + 2;
        textarea.placeholder = '# Write your function code here\n';
    }

    const div = document.createElement('div');
    div.className = 'func-code-box';
    const label = document.createElement('label');
    label.textContent = 'Function Code';
    div.appendChild(label);
    div.appendChild(textarea);
    return div;
}
function makeTextarea(data, field, update, end) {
    const textarea = document.createElement('textarea');

    // auto-resize the textarea if field-sizing is not supported
    if (!CSS.supports("field-sizing: content")) {
        textarea.addEventListener('input', (e) => {
            e.target.style.height = "";
            e.target.style.height = e.target.scrollHeight + 5 + "px";
        });
        setTimeout(() => {
            textarea.style.height = textarea.scrollHeight + 5 + "px";
        }, 0);
    }

    // set up the textarea
    textarea.className = `func-${field}`;
    textarea.value = data[field] || '';
    textarea.readOnly = isReadOnly(data, field);
    if (!textarea.readOnly) {
        textarea.addEventListener('input', (e) => { update(field, e.target.value); });
        textarea.addEventListener('blur', (e) => { end(field, e.target.value); });
    }

    return textarea;
}

function makeParams(diagram, data, update, end) {
    return createVarsBox(diagram, "Parameter", "params", data, update, end, saveParams, makeParam);
}
function makeParam(diagram, data, save, index=-1) {
    const pData = (index >= 0) ? data.params[index] : { name: '', type: '', desc: '' };
    const ro = isReadOnly(data, 'params') || isReadOnly(data, `params.${pData.name}`) || isReadOnly(data, `params.${index}`);
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
    const ro = isReadOnly(data, 'returns') || isReadOnly(data, `returns.${index}`);
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
    addAddButton(div, () => { make(); save(true); }, isReadOnly(data, field));
    div.appendChild(list);
    for (const index of (data[field] || []).keys()) { make(index); }
    // save();
    if (!isReadOnly(data, field)) {
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
function getTypeText(type) {
    if (type === "list") { return "list of ..."; }
    if (type === "tuple") { return "tuple with ..."; }
    if (type === "dict") { return "dict with ..."; }
    if (type === "set") { return "set of ..."; }
    if (type === "custom") { return "custom..."; }
    return type;
}
function removeCustomTypeOption(select) {
    // const options = select.options;
    // if (options[options.length - 1].customType) { select.removeChild(options[options.length - 1]); }
}
function addCustomTypeOption(select, type) {
    //removeCustomTypeOption(select);
    const opt = makeOption(type, type);
    opt.customType = true;
    opt.setAttribute("data-custom-type", "true");
    select.options.add(opt);
    select.value = type;
}
function addTypeElement(diagram, elem, value, callback, locked=false) {
    const holder = document.createElement("span");
    holder.className = "func-var-type-holder";
    elem.appendChild(holder);

    const type = document.createElement("select");
    type.addEventListener("change", async () => {
        if (type.selectedOptions[0].text.endsWith("...")) {
            const result = await showTypeBuilder(diagram, type.value);
            if (result === null) { type.value = type.lastSelected; return; }
            addCustomTypeOption(type, result);
        } else { removeCustomTypeOption(type); }
        callback();
    });
    type.appendChild(makeOption("", "type")); // blank option
    for (const t of diagram.allowedTypes) {
        type.appendChild(makeOption(t, getTypeText(t)));
    }
    const allSpecialTypes = new Set();
    for (const funcNode of diagram.nodes) {
        const all = (funcNode.data.returns || []).concat(funcNode.data.params || []).map(v => v.type)
            .filter(type => type && !diagram.allowedTypes.includes(type));
        console.log(all);
        if (all.length > 0) { allSpecialTypes.add(...all); }
    }
    for (const t of allSpecialTypes) {
        addCustomTypeOption(type, t);
    }

    type.className = "func-var-type";
    if (value && diagram.allowedTypes.includes(value)) { type.value = value; }
    else if (value) { addCustomTypeOption(type, value); }
    type.lastSelected = type.selectedOptions[0].value;
    type.disabled = locked;
    holder.appendChild(type);

    if (!locked) {
        // edit button
        const button = document.createElement("button");
        button.type = "button";
        button.className = "func-var-type-edit";
        button.title = "Edit Type...";
        button.innerHTML = "&#9998;";
        button.addEventListener("click", async () => {
            const result = await showTypeBuilder(diagram, type.value);
            if (result !== null) { addCustomTypeOption(type, result); callback(); }
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

function isReadOnly(data, type) {
    // The data.readOnly can be a boolean (overall read-only) or an array of strings of read only parts
    // The part/type can be:
    //     one of the fields: 'name', 'params', 'returns', 'desc', 'io', 'testable'
    //     one of the special values: 'calls' (both in or out), 'callsInto', 'callsOutOf'
    return data.readOnly === true || (Array.isArray(data.readOnly) && data.readOnly.includes(type));
}
