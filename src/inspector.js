/**
 * General UI elements for the function and module inspectors.
 */

import { makeOption } from "./utils.js";

/**
 * Sets up a resizable inspector div next to the diagram div.
 * @param {object} diagram 
 * @returns {HTMLElement} the inspector div
 */
export function setupInspector(diagram) {
    const diagramDiv = diagram.div;
    const rootElem = diagramDiv.parentNode;

    const resizer = document.createElement('div');
    resizer.className = 'inspector-resizer';
    rootElem.appendChild(resizer);

    const inspectorDiv = document.createElement('div');
    inspectorDiv.className = 'inspector';
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

    return inspectorDiv;
}

/**
 * Updates the problems shown in the inspector. This highlights fields with problems
 * and shows a list of problems.
 * @param {HTMLElement} inspectorDiv 
 * @param {Array} problems 
 */
export function updateProblemsInInspector(inspectorDiv, problems) {
    // update the highlighting
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

    // update the problems div
    const problemsDiv = inspectorDiv.querySelector('div.problems');
    if (problems.length > 0) {
        problemsDiv.innerHTML = '<h3>Problems</h3><ul class="problems">' + 
            problems.map(p => `<li class="${p[0]}">${p[2]}</li>`).join('') + '</ul>';
    } else {
        problemsDiv.innerHTML = '';
    }
}

/**
 * Wraps an element with a label. The text is placed before the element in a span.
 * @param {HTMLElement} elem 
 * @param {string} text 
 * @returns {HTMLElement} the label element
 */
export function wrapWithLabel(elem, text) {
    const label = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = text;
    label.appendChild(span);
    label.appendChild(elem);
    return label;
}

/**
 * Creates a checkbox for a particular field in the data.
 * @param {*} diagram 
 * @param {object} data 
 * @param {string} field 
 * @param {function} set 
 * @returns {HTMLElement} the checkbox element
 */
export function makeCheckbox(diagram, data, field, set) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = `func-${field}`;
    checkbox.checked = data[field] || false;
    checkbox.disabled = !diagram.adminMode && isReadOnly(data, field);
    checkbox.addEventListener('change', (e) => { set(field, e.target.checked); });
    return checkbox;
}

/**
 * Creates a textarea for a particular field in the data.
 * @param {*} diagram 
 * @param {object} data 
 * @param {string} field 
 * @param {function} update 
 * @param {function} end 
 * @param {string} placeholder 
 * @returns {HTMLElement} the textarea element
 */
export function makeTextarea(diagram, data, field, update, end, placeholder = '') {
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
    textarea.placeholder = placeholder;
    textarea.readOnly = !diagram.adminMode && isReadOnly(data, field);
    if (!textarea.readOnly) {
        textarea.addEventListener('input', (e) => { update(field, e.target.value); });
        textarea.addEventListener('blur', (e) => { end(field, e.target.value); });
    }

    return textarea;
}

/**
 * Creates a code editor for a particular field. If the field is read-only,
 * it creates a syntax-highlighted div instead of a textarea.
 * @param {*} diagram 
 * @param {object} data 
 * @param {string} field 
 * @param {function} update 
 * @param {function} end 
 * @param {string} title 
 * @param {string} placeholder 
 * @returns {HTMLElement} the code editor element
 */
export function makeCodeEditor(diagram, data, field, update, end,
    title = 'Function Code', placeholder = '# Write your function code here\n') {
    let code = data[field] || '';
    let textarea;
    const ro = !diagram.adminMode && isReadOnly(data, field);
    if (ro && typeof Prism !== 'undefined') {
        textarea = document.createElement('div');
        textarea.className = `func-${field} language-python code-box`;
        textarea.innerHTML = Prism.highlight(code, Prism.languages.python, 'python');
    } else {
        textarea = makeTextarea(diagram, data, field, update, end, placeholder);
        textarea.rows = code.trim().split('\n').length + 2;
        textarea.classList.add('code-box');
    }

    const div = document.createElement('div');
    div.className = `func-code-box`;
    const label = document.createElement('label');
    label.textContent = title;
    div.appendChild(label);
    div.appendChild(textarea);
    return div;
}

/**
 * Creates a code editor for a particular field with an optional checkbox to show/hide it.
 * If the field is read-only, it creates a syntax-highlighted div instead of a textarea. The
 * checkbox is only shown in admin mode.
 * @param {HTMLElement} div parent div to append to
 * @param {*} diagram 
 * @param {object} data 
 * @param {string} field 
 * @param {function} update 
 * @param {function} end 
 * @param {function} set 
 * @param {string} title 
 * @param {string} placeholder 
 */
export function makeCodeEditorWithShowCheckbox(
    div, diagram, data, field, update, end, set, title, placeholder
) {
    const showField = `show${field.charAt(0).toUpperCase() + field.slice(1)}`;
    if ((data[showField] && (data[field] || !isReadOnly(data, field))) || diagram.adminMode) {
        div.appendChild(makeCodeEditor(diagram, data, field, update, end, title, placeholder));
        if (diagram.adminMode) {
            div.appendChild(wrapWithLabel(makeCheckbox(diagram, data, showField, set), `Show ${title}:`));
        }
    }
}

/**
 * Creates a read-only select element for choosing which parts of the data are read-only.
 * @param {*} diagram 
 * @param {object} data 
 * @param {function} set 
 * @param {string[]} possibleTypes 
 * @returns {HTMLElement} the container div with the select and checkboxes
 */
export function makeReadOnlySelect(diagram, data, set, possibleTypes) {
    let container = document.createElement('div');
    container.className = 'func-readonly';
    let isCustom = Array.isArray(data.readOnly) && data.readOnly.length > 0;
    const select = document.createElement('select');
    select.appendChild(makeOption('all'));
    select.appendChild(makeOption('none'));
    select.appendChild(makeOption('custom'));
    select.value = isCustom ? 'custom' : (data.readOnly === true ? 'all' : 'none');
    select.addEventListener('change', (e) => {
        const val = e.target.value;
        let value;
        if (val === 'all') {
            value = true;
        } else if (val === 'none') {
            value = false;
        } else {
            const checkAll = data.readOnly === true;
            value = checkAll ? [...possibleTypes] : [];
            for (const cb of container.querySelectorAll('input[type=checkbox]')) {
                cb.checked = checkAll;
            }
        }
        set('readOnly', value);
    });
    container.appendChild(wrapWithLabel(select, 'Readonly:'));

    // TODO: doesn't support individual params or returns
    // TODO: calls/callsInto/callsOutOf should be specially handled

    function onCheckBoxClick(e) {
        const cb = e.target;
        let readOnly = Array.isArray(data.readOnly) ? [...data.readOnly] : [];
        if (cb.checked) {
            if (!readOnly.includes(cb.value)) {
                readOnly.push(cb.value);
            }
        } else {
            readOnly = readOnly.filter(v => v !== cb.value);
        }
        set('readOnly', readOnly);
    }

    for (const type of possibleTypes) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.name = `readonly-${type}`;
        cb.value = type;
        cb.checked = isCustom && data.readOnly.includes(type);
        cb.addEventListener('change', onCheckBoxClick);

        const label = document.createElement('label');
        const span = document.createElement('span');
        span.textContent = type;
        label.appendChild(cb);
        label.appendChild(span);
        container.appendChild(label);
    }

    return container;
}

/**
 * Checks if a particular part of the data is read-only. The data.readOnly field can be a boolean
 * (overall read-only) or an array of strings of read only parts.
 * The part/type can be:
 *      one of the fields: 'name', 'params', 'returns', 'desc', 'io', 'testable', 'code'
 *      one of the sub-fields: 'params.{name}', 'params.{index}', 'returns.{index}'
 *      one of the special values: 'calls' (both in or out), 'callsInto', 'callsOutOf'
 * For modules, type can be one of 'documentation', 'testDocumentation', 'globalCode'
 * @param {object} data 
 * @param {string} type 
 * @returns {boolean} whether the type is read-only
 */
export function isReadOnly(data, type) {
    return data.readOnly === true || (Array.isArray(data.readOnly) && data.readOnly.includes(type));
}
