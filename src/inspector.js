/**
 * General UI elements for the function and module inspectors.
 */

import Prism from "prismjs";
import 'prismjs/components/prism-python.min.js';

import { makeOption } from "./utils.js";

/**
 * Sets up a resizable inspector div next to the diagram div.
 * @param {HTMLElement} diagramDiv - the diagram div
 * @returns {HTMLElement} the inspector div
 */
export function setupInspector(diagramDiv) {
    const rootElem = diagramDiv.parentNode;

    const resizer = document.createElement('div');
    resizer.className = 'inspector-resizer';

    const inspectorDiv = document.createElement('div');
    inspectorDiv.className = 'inspector';
    rootElem.append(resizer, inspectorDiv);

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
 * Creates a div that shows the problems in the data.
 * @param {function} listen 
 * @returns {HTMLElement} the problems div
 */
export function makeProblemsDiv(listen) {
    const problemsDiv = document.createElement('div');
    problemsDiv.className = 'problems';
    listen((_, problems) => { updateProblemsInInspector(problemsDiv.parentNode, problems); });
    return problemsDiv;
}

/**
 * Updates the problems shown in the inspector. This highlights fields with problems
 * and shows a list of problems.
 * @param {HTMLElement} div 
 * @param {Array} problems 
 */
function updateProblemsInInspector(div, problems) {
    // update the highlighting
    for (const elem of Array.from(div.getElementsByClassName('error'))) { elem.classList.remove('error'); elem.title = ''; }
    for (const elem of Array.from(div.getElementsByClassName('warning'))) { elem.classList.remove('warning'); elem.title = ''; }
    for (const [type, fields, message] of problems) {
        for (const field of fields.split(',')) {
            let elem;
            if (field.includes("[")) {
                // handle array-like fields (e.g., params[0].name)
                const [baseField, rem] = field.split('[');
                const [index, name_] = rem.split(']');
                const name = name_.slice(1);
                elem = div.getElementsByClassName(`func-${baseField}`)[0]
                    ?.getElementsByClassName(`func-var-${name}`)[index];
            } else {
                elem = div.getElementsByClassName(`func-${field}`)[0];
            }
            if (elem) {
                elem.classList.add(type);
                elem.title = message;
            }
        }
    }

    // update the problems div
    const problemsDiv = div.querySelector('div.problems');
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
    label.append(span, elem);
    return label;
}

/**
 * Creates a checkbox for a particular field in the data.
 * @param {string} field 
 * @param {{set: function, listen: function, listenRO: function}} funcs
 * @returns {HTMLElement} the checkbox element
 */
export function makeCheckbox(field, funcs) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = `func-${field}`;
    checkbox.addEventListener('change', (e) => { funcs.set(field, e.target.checked); });
    funcs.listen(field, (value) => { checkbox.checked = value; });
    funcs.listenRO(field, (readOnly) => { checkbox.disabled = readOnly; });
    return checkbox;
}

/**
 * Creates a textarea for a particular field in the data.
 * @param {string} field 
 * @param {{set: function, listen: function, listenRO: function}} funcs
 * @param {object} attrs 
 * @returns {HTMLElement} the textarea element
 */
export function makeTextarea(field, funcs, attrs={}) {
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
    for (const [k, v] of Object.entries(attrs)) { textarea[k] = v; }
    textarea.addEventListener('input', (e) => { funcs.set(field, e.target.value, e.target.selectionStart); });
    funcs.listen(field, (value) => {
        value = value?.toString() || '';
        if (textarea.value !== value) {
            textarea.value = value;
            textarea.rows = value.trim().split('\n').length + 2;
        }
    });
    funcs.listenRO(field, (readOnly) => { textarea.readOnly = readOnly; });

    return textarea;
}

/**
 * Creates a code editor for a particular field. If the field is read-only,
 * it creates a syntax-highlighted div instead of a textarea.
 * @param {string} field 
 * @param {{set: function, listen: function, listenRO: function}} funcs
 * @param {string} title 
 * @param {string} placeholder 
 * @returns {HTMLElement} the code editor element
 */
export function makeCodeEditor(field, funcs,
    title = 'Function Code', placeholder = '# Write your function code here\n') {
    const div = document.createElement('div');
    div.className = `func-code-box`;

    const label = document.createElement('label');
    label.textContent = title;

    const textarea = makeTextarea(field, funcs, {placeholder});
    textarea.classList.add('code-box');
    div.append(label, textarea);

    const codeBox = document.createElement('div');
    codeBox.className = `func-${field} language-python code-box`;
    funcs.listen(field, (value) => {
        value = value?.toString() || ' ';
        codeBox.innerHTML = Prism.highlight(value, Prism.languages.python, 'python');
    });
    funcs.listenRO(field, (readOnly) => {
        textarea.style.display = readOnly ? 'none' : '';
        codeBox.style.display = !readOnly ? 'none' : '';
    });
    div.appendChild(codeBox);

    return div;
}

/**
 * Creates a code editor for a particular field with an optional checkbox to show/hide it.
 * If the field is read-only, it creates a syntax-highlighted div instead of a textarea. The
 * checkbox is only shown in admin mode.
 * @param {object} options
 * @param {string} field 
 * @param {{set: function, listen: function, listenRO: function}} funcs
 * @param {string} title 
 * @param {string} placeholder 
 */
export function makeCodeEditorWithShowCheckbox(options, field, funcs, title, placeholder) {
    const showField = `show${field.charAt(0).toUpperCase() + field.slice(1)}`;
    const div = makeCodeEditor(field, funcs, title, placeholder);
    if (options.adminMode) {
        div.appendChild(wrapWithLabel(makeCheckbox(showField, funcs), `Show ${title}:`));
    } else {
        let showing = false, val = '', ro = false;
        function updateVisibility() { div.style.display = showing && (val || !ro) ? '' : 'none'; }
        funcs.listen(showField, (value) => { showing = value; updateVisibility(); });
        funcs.listen(field, (value) => { val = value?.toString() || ''; updateVisibility(); });
        funcs.listenRO(field, (readOnly) => { ro = readOnly; updateVisibility(); });
    }
    return div;
}

/**
 * Creates a read-only select element for choosing which parts of the data are read-only.
 * @param {{set: function, listen: function}} funcs
 * @param {string[]} possibleTypes 
 * @returns {HTMLElement} the container div with the select and checkboxes
 */
export function makeReadOnlySelect(funcs, possibleTypes) {
    // TODO: doesn't support individual params or returns
    // TODO: calls/callsInto/callsOutOf should be specially handled

    let container = document.createElement('div');
    container.className = 'func-readonly';

    const select = document.createElement('select');
    select.append(makeOption('all'), makeOption('none'), makeOption('custom'));
    container.appendChild(wrapWithLabel(select, 'Readonly:'));

    const checkboxes = [];
    for (const type of possibleTypes) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.name = `readonly-${type}`;
        cb.value = type;

        const label = document.createElement('label');
        const span = document.createElement('span');
        span.textContent = type;
        label.append(cb, span);
        container.appendChild(label);
        checkboxes.push(cb);
    }

    function setReadOnly() {
        funcs.set('readOnly',
            select.value !== 'custom' ? select.value === 'all' :
                checkboxes.filter(cb => cb.checked).map(cb => cb.value)
        );
    }
    select.addEventListener('change', setReadOnly);
    checkboxes.forEach(cb => cb.addEventListener('change', setReadOnly));

    funcs.listen('readOnly', (value) => {
        value = value ?? false;
        if (value === true || value === false) {
            select.value = value ? 'all' : 'none';
            for (const cb of checkboxes) { cb.checked = value; }
        } else {
            select.value = 'custom';
            for (const cb of checkboxes) { cb.checked = value.includes(cb.value); }
        }
    });

    return container;
}

/**
 * Checks if a particular part of the data is read-only. The data.readOnly field can be a boolean
 * (overall read-only) or an array of strings of read only parts.
 * The part/type can be:
 *      one of the fields: 'name', 'params', 'returns', 'desc', 'io', 'testable', 'code'
 *      one of the sub-fields: 'params.{name}', 'params[{index}]', 'returns[{index}]'
 *      one of the special values: 'calls' (both in or out), 'callsInto', 'callsOutOf'
 * For modules, type can be one of 'documentation', 'testDocumentation', 'globalCode'
 * @param {object|Y.Map|boolean|array} data either the data object or the readOnly field
 * @param {string} type 
 * @returns {boolean} whether the type is read-only
 */
export function isReadOnly(data, type, options={}) {
    if (options.adminMode) { return false; }
    const ro =  data.get ? data.get('readOnly') : (data.readOnly !== undefined ? data.readOnly : data);
    return (ro === true || (Array.isArray(ro) && ro.includes(type)));
}
