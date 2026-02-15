/**
 * Functions for setting up and managing the function inspector panel.
 */

import Sortable from 'sortablejs';
import Swal from 'sweetalert2';

import { wrapWithLabel, makeCheckbox, makeTextarea, makeCodeEditorWithShowCheckbox, makeReadOnlySelect, makeProblemsDiv, isReadOnly } from './inspector.js';
import { loadSVG, makeOption } from './utils.js';

import addIcon from '../images/add.svg';
import removeIcon from '../images/remove.svg';

import TypeEditor from './type-editor.js';

/**
 * Create the function inspector panel. The same panel is reused for all functions. The returned
 * setKey function is used to change which function is being displayed.
 * @param {*} model 
 * @param {object} options 
 * @returns {[HTMLElement, function]} the function inspector div and setKey function
 */
export function makeFunctionInspector(model, options) {
    const div = document.createElement('div');
    let key = null;

    function set(property, value, cursorPos=null) { model.updateFunc(key, property, value, cursorPos); }
    function add(property, index=-1) { model.addFuncItem(key, property, index); }
    function remove(property, index) { model.removeFuncItem(key, property, index); }
    function move(property, index, newIndex) { model.moveFuncItem(key, property, index, newIndex); }

    function listen(property, listener) {
        model.addFuncListener(property, (actualKey, prop, value) => {
            if (actualKey === key) { listener(value, prop, key); }
        });
    }
    function listenRO(property, listener) {
        if (options.adminMode) { listener(false); }
        else {
            model.addFuncListener('readOnly', (actualKey, _, value) => {
                if (actualKey === key) { listener(isReadOnly(value ?? false, property)); }
            });
        }
    }

    const funcs = { set, add, remove, move, listen, listenRO };

    function setKey(newKey) {
        if (key === newKey) { return; }
        key = newKey;
        model.fireFuncListeners(key);
    }

    div.append(
        makeFuncName(funcs),
        makeFuncDesc(funcs),
        makeParams(model, options, funcs),
        makeReturns(model, options, funcs),
        makeIOSelect(funcs),
        makeTestableCheckbox(funcs),
        makeProblemsDiv((listener) => {
            model.addFuncListener('problems', (actualKey, _, problems) => {
                if (actualKey === key) {
                    listener(null, (problems || []).concat(model.getFuncLinkProblems(key)));
                }
            });
            model.addFuncListener('linkProblems', (actualKey, _, linkProblems) => {
                if (actualKey === key) {
                    listener(null, model.getFuncProblems(key).concat(linkProblems || []));
                }
            });
        }),
        makeCodeEditorWithShowCheckbox(options, 'code', funcs,
            'Function Code', '# Write your function code here\n'),
        makeCodeEditorWithShowCheckbox(options, 'testCode', funcs,
            'Test Code', '# Write your test code here\n')
    );
    if (options.adminMode) {
        div.appendChild(makeReadOnlySelect(funcs,
            ['name', 'params', 'returns', 'desc', 'io', 'testable', 'code', 'testCode', 'calls', 'callsInto', 'callsOutOf']));
    }

    return [div, setKey];
}

function makeFuncName(funcs) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'func-name';
    input.placeholder = 'function';
    input.required = true;
    input.pattern = '[a-zA-Z_][a-zA-Z0-9_]*';
    const h2 = document.createElement('h2');
    h2.appendChild(input);

    const checkIsMain = () => { h2.parentElement.classList.toggle('is-main', input.value.trim() === 'main'); };
    let updateName = () => { checkIsMain(); };
    if (!CSS.supports("field-sizing: content")) {
        // auto-resize the input box if field-sizing is not supported
        // can do this because it uses a monospace font
        updateName = () => { checkIsMain(); input.size = (input.value || input.placeholder).length; }
    }

    // listeners
    input.addEventListener('input', (e) => {
        funcs.set('name', createValidIdentifier(e.target.value), e.target.selectionStart);
        updateName();
    });
    funcs.listen('name', (value) => {
        value = value?.toString() || '';
        if (input.value !== value) { input.value = value; }
        updateName();
    });
    funcs.listenRO('name', (value) => { input.readOnly = value; });
    return h2;
}
function createValidIdentifier(name) {
    if (name.includes('(')) { name = name.split('(')[0]; }
    return name.trim().replace(/[^a-zA-Z0-9_]/g, '_');
}
function makeFuncDesc(funcs) {
    return makeTextarea('desc', funcs, {placeholder: 'Description', required: true});
}
function makeIOSelect(funcs) {
    const select = document.createElement('select');
    select.className = 'func-io';
    [
        { value: 'none', text: 'None' },
        { value: 'indirect', text: 'Indirect I/O' },
        { value: 'output', text: 'Output Only' },
        { value: 'input', text: 'Basic Input' },
        { value: 'validation', text: 'Validated Input' }
    ].forEach(opt => select.appendChild(makeOption(opt.value, opt.text)));

    select.addEventListener('change', (e) => { funcs.set('io', e.target.value); });
    funcs.listen('io', (value) => { select.value = value?.toString() || 'none'; });
    funcs.listenRO('io', (value) => { select.disabled = value; });

    return wrapWithLabel(select, 'User I/O: ');
}
function makeTestableCheckbox(funcs) {
    return wrapWithLabel(makeCheckbox('testable', funcs), 'Testable: ');
}


////////// Parameters and Returns //////////
function makeParams(model, options, funcs) { return createVarsBox(model, options, "Parameter", "params", true, funcs); }
function makeReturns(model, options, funcs) { return createVarsBox(model, options, "Return", "returns", false, funcs); }
function createVarsBox(model, options, name, property, hasName, funcs) {
    const div = document.createElement("div");
    div.className = `func-${property} func-vars`;
    const h3 = document.createElement("h3");
    h3.textContent = name+"(s)";
    const list = document.createElement("div");
    div.append(h3, list);
    const initAdd = makeAddButton();
    div.appendChild(initAdd);

    function setProp(index, subprop, value, cursorPos=null) { funcs.set(`${property}[${index}].${subprop}`, value, cursorPos); }
    function getIndex(e) { return Array.prototype.indexOf.call(list.children, e.target.closest(".func-var")); }

    // name and desc listeners
    list.addEventListener("input", (e) => {
        if (e.target.closest(".sortable-ghost") || e.target.closest(".sortable-drag")) { return; }
        for (const clazz of e.target.classList) {
            if (clazz.startsWith("func-var-")) {
                const [, , prop] = clazz.split('-'); // prop === "name" || prop === "desc"
                setProp(getIndex(e), prop, e.target.value, e.target.selectionStart);
            }
        }
    });
    // type listeners
    list.addEventListener("change", async (e) => {
        if (e.target.closest(".sortable-ghost") || e.target.closest(".sortable-drag")) { return; }
        if (!e.target.selectedOptions) { return; }
        if (e.target.selectedOptions[0].text.endsWith("...")) {
            const result = await showTypeBuilder(options, e.target.value);
            if (result === null) { e.target.value = e.target.lastSelected; return; }
            setProp(getIndex(e), "type", result);
        } else {
            setProp(getIndex(e), "type", e.target.value);
        }
    });
    // add/remove + edit type buttons
    div.addEventListener("click", async (e) => {
        if (e.target.closest(".sortable-ghost") || e.target.closest(".sortable-drag")) { return; }
        const edit = e.target.closest(".func-var-type-edit");
        if (edit) {
            const result = await showTypeBuilder(options, edit.parentElement.querySelector(".func-var-type").value);
            if (result !== null) { setProp(getIndex(e), "type", result); }
        } else {
            const target = e.target.closest(".func-var-button");
            if (!target) { return; }
            if (target.classList.contains("func-var-button-add")) { funcs.add(property, target === initAdd ? -1 : getIndex(e)); }
            else if (target.classList.contains("func-var-button-remove")) { funcs.remove(property, getIndex(e)); }
        }
    });

    Sortable.create(list, {
        group: property,
        handle: '.func-var-drag-handle',
        filter: '.func-var-drag-disabled',
        direction: 'vertical',
        onUpdate: (evt) => { funcs.move(property, evt.oldIndex, evt.newIndex); },
    });

    function itemIsRO(ro, index, name=null) {
        return isReadOnly(ro, property) ||
            isReadOnly(ro, `${property}[${index}]`) ||
            (name && isReadOnly(ro, `${property}.${name}`));
    }

    function itemPropIsRO(ro, index, subprop, name=null) {
        return isReadOnly(ro, property) ||
            isReadOnly(ro, `${property}[${index}]`) || isReadOnly(ro, `${property}[${index}].${subprop}`) ||
            (name && (isReadOnly(ro, `${property}.${name}`) || isReadOnly(ro, `${property}.${name}.${subprop}`)));
    }

    function updateItemRO(box, i, ro) {
        const name = hasName ? box.querySelector(".func-var-name") : null;
        const type = box.querySelector(".func-var-type");
        const desc = box.querySelector(".func-var-desc");
        const add = box.querySelector(".func-var-button-add");
        const remove = box.querySelector(".func-var-button-remove");
        const drag = box.querySelector(".func-var-drag-handle");

        const nameValue = name?.value?.trim();

        if (name) { name.readOnly = itemPropIsRO(ro, i, "name", nameValue); }
        type.disabled = itemPropIsRO(ro, i, "type", nameValue);
        desc.readOnly = itemPropIsRO(ro, i, "desc", nameValue);

        const itemRO = itemIsRO(ro, i, nameValue);
        box.classList.toggle("func-var-readonly", itemRO);
        add.classList.toggle("func-var-button-disabled", itemRO);
        remove.classList.toggle("func-var-button-disabled", itemRO);
        drag.classList.toggle("func-var-drag-disabled", itemRO);
    }

    funcs.listen(property, (value, rawProp, key) => {
        const [_, index, prop] = model.parseFuncProperty(rawProp);
        // assert _ === property
        if (index == null) {
            // initial setup/insert/remove
            // TODO: could this be smarter and not re-make all items?
            if (value == null || value.length === 0) { list.innerHTML = ""; }  // remove all boxes
            else {
                // get the right number of boxes
                if (value.length > list.children.length) {
                    for (let i = list.children.length; i < value.length; i++) {
                        const box = makeVarBox(model, options, hasName);
                        list.appendChild(box);
                        if (!options.adminMode) {
                            updateItemRO(box, i, model.functions.get(key).get('readOnly') ?? false);
                        }
                    }
                } else if (value.length < list.children.length) {
                    for (let i = value.length; i < list.children.length; i++) { list.children[i].remove(); }
                }
                // update all boxes
                for (const [i, v] of value.entries()) { updateVarBox(list, i, v, hasName); }
            }
        } else if (prop == null) {
            // update single item with an entire object (this happens when a new property is added)
            updateVarBox(list, index, value, hasName);
        } else {
            // update single property (this happens when an existing property is updated)
            const input = list.children[index].querySelector(`.func-var-${prop}`);
            if (input) {
                const val = value?.toString() ?? "";
                if (prop === "type") { setCustomTypeOption(input, val); }
                else if (input.value !== val) { input.value = val; }
            }
        }
    });

    // readonly listeners
    // cannot use funcs.listenRO here because we need to set up multiple listeners for each property
    if (!options.adminMode) {
        funcs.listen('readOnly', (value) => {
            const ro = value ?? false;
            const masterRO = isReadOnly(ro, property);
            div.classList.toggle("func-vars-readonly", masterRO);
            initAdd.classList.toggle("func-var-button-disabled", masterRO);
            for (let i = 0; i < list.children.length; i++) {
                updateItemRO(list.children[i], i, ro);
            }
        });
    }

    return div;
}

function updateVarBox(list, index, value, hasName) {
    const box = list.children[index];

    // update name
    if (hasName) {
        const val = value.name?.toString() ?? "";
        const name = box.querySelector(".func-var-name");
        if (name.value !== val) { name.value = val; }
    }

    // update type
    const newType = value.type?.toString() ?? "";
    const type = box.querySelector(".func-var-type");
    setCustomTypeOption(type, newType);

    // update description
    const val = value.desc?.toString() ?? "";
    const desc = box.querySelector(".func-var-desc");
    if (desc.value !== val) { desc.value = val; }
}
function makeVarBox(model, options, hasName) {
    const box = document.createElement("div");
    box.className = "func-var";
    box.append(
        makeDragHandle(),
        makeAddButton(),
        makeRemoveButton()
    );
    if (hasName) {
        box.append(
            makeNameElement(),
            document.createElement("span"), " : "
        );
    }
    box.append(
        makeTypeElement(model, options),
        makeDescElement()
    );
    return box;
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
    if (!select.selectedOptions[0].text.endsWith("...")) {
        select.lastSelected = select.value;
    }
    if (type === "") { select.value = ""; return; }
    const matches = [...select.options].filter(opt => opt.value === type);
    if (matches.length === 0) { addCustomTypeOptionToAll(select, type); }
    select.value = type;
}
function getAllSpecialTypes(model, options) {
    const allSpecialTypes = new Set();
    for (const func of model.functions.values()) {
        const returns = func.get('returns')?.toJSON() || [];
        const params = func.get('params')?.toJSON() || [];
        const all = returns.concat(params).map(v => v.type)
            .filter(type => type && !options.allowedTypes.includes(type));
        for (const t of all) {
            allSpecialTypes.add(t);
        }
    }
    return allSpecialTypes;
}
function makeTypeElement(model, options) {
    const holder = document.createElement("span");
    holder.className = "func-var-type-holder";

    // type select
    const select = document.createElement("select");
    select.className = "func-var-type";
    select.appendChild(makeOption("", "type")); // blank option
    for (const t of options.allowedTypes) {
        select.appendChild(makeOption(t, getTypeText(t)));
    }
    for (const t of getAllSpecialTypes(model, options)) {
        addCustomTypeOption(select, t);
    }

    // edit button
    const button = document.createElement("button");
    button.type = "button";
    button.className = "func-var-type-edit";
    button.title = "Edit Type...";
    button.innerHTML = "&#9998;";

    holder.append(select, button);
    return holder;
}
async function showTypeBuilder(options, initialType) {
    let result = null;
    const returnValue = await Swal.fire({
        theme: options.theme,
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
                onChange, allowedTypes: options.allowedTypes, initialType: initialType.trim()
            });
        },
    });
    return returnValue.isConfirmed ? result : null;
}

// Other parts of a variable box
function makeDragHandle() {
    const handle = document.createElement("div");
    handle.className = "func-var-drag-handle";
    return handle;
}
function makeNameElement() {
    const name = document.createElement("input");
    name.type = "text";
    name.className = "func-var-name";``
    name.placeholder = "name";
    name.required = true;
    name.pattern = "[a-zA-Z_][a-zA-Z0-9_]*";
    return name;
}
function makeDescElement() {
    const desc = document.createElement("input");
    desc.type = "text";
    desc.className = "func-var-desc";
    desc.placeholder = "description";
    desc.required = true;
    return desc;
}
function makeVarButton(name) {
    const button = document.createElement("div");
    button.className = "func-var-button func-var-button-" + name;
    loadSVG(name === "remove" ? removeIcon : addIcon, button, name === "remove" ? "x" : "+");
    return button;
}
function makeAddButton() { return makeVarButton("add"); }
function makeRemoveButton() { return makeVarButton("remove"); }
