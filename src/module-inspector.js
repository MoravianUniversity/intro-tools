/**
 * Functions for setting up and managing the module inspector that displays
 * when no function is selected.
 */

import { wrapWithLabel, makeCheckbox, makeTextarea, makeReadOnlySelect, makeCodeEditorWithShowCheckbox, makeProblemsDiv, isReadOnly } from './inspector.js';
import { DEFAULT_PROGRAM_HEADER } from './save-load.js';

/**
 * Creates the module inspector div.
 * @param {*} model 
 * @param {object} options 
 * @returns {HTMLElement} the module inspector div
 */
export function makeModuleInspector(model, options) {
    const div = document.createElement('div');

    function set(property, value, cursorPos=null) { model.updateModelData(property, value, cursorPos); }
    function listen(property, listener) { model.addModelDataListener(property, (_, value) => listener(value)); }
    function listenRO(property, listener) {
        if (options.adminMode) { listener(false); }
        else {
            model.addModelDataListener('readOnly', (_, value) => {
                listener(isReadOnly(value ?? false, property));
            });
        }
    }
    const funcs = {set, listen, listenRO};

    div.append(
        ...makeHeader(model),
        makeModuleDesc(funcs),
        makeAuthorNames(funcs),
        makeTestDocumentation(model, options, funcs)
    );
    if (options.adminMode) {
        div.appendChild(makeShowTestDocumentationCheckbox(funcs));
    }
    div.appendChild(makeGlobalCodeEditor(options, funcs));
    if (options.adminMode) {
        div.appendChild(makeReadOnlySelect(funcs,
            ['documentation', 'testDocumentation', 'globalCode']));
    }
    div.appendChild(makeProblemsDiv((listener) => model.addModelDataListener('problems', listener)));

    model.fireModelDataListeners();

    return div;
}

function makeHeader(model) {
    const title = document.createElement('h2');
    title.textContent = (model.id || 'Module');
    const info = document.createElement('p');
    info.textContent = 'Select a function to edit it.\nEdit program-wide settings here.';
    return [title, info];
}

function makeModuleDesc(funcs) {
    return makeTextarea('documentation', funcs,
        {placeholder: DEFAULT_PROGRAM_HEADER, required: true});
}

function makeAuthorNames(funcs) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'func-authors';
    input.placeholder = 'Authors...';
    input.required = true;
    input.addEventListener('input', (e) => { funcs.set('authors', e.target.value, e.target.selectionStart); });
    funcs.listen('authors', (value) => {
        value = value ?? '';
        if (input.value !== value) { input.value = value; }
    });
    funcs.listenRO('authors', (value) => { input.readOnly = value; });
    return wrapWithLabel(input, 'By:');
}

function makeTestDocumentation(model, options, funcs) {
    const textarea = makeTextarea('testDocumentation', funcs,
            {placeholder: `Tests for the "${model.id}" module`});
    const label = wrapWithLabel(textarea, 'Test Documentation');
    if (!options.adminMode) {
        function toggleShowing() {
            const hasTestable = Array.from(model.functions.values()).some(n => n.get('testable'));
            label.style.display = hasTestable && model.modelData.get('showTestDocumentation') ? '' : 'none';
        }
        funcs.listen('showTestDocumentation', toggleShowing);
        model.addFuncListener('testable', toggleShowing);
    }
    return label;
}

function makeShowTestDocumentationCheckbox(funcs) {
    return wrapWithLabel(makeCheckbox('showTestDocumentation', funcs), 'Show Test Documentation: ');
}

function makeGlobalCodeEditor(options, funcs) {
    return makeCodeEditorWithShowCheckbox(options, 'globalCode', funcs,
        'Global Code', '# Write your module-level code here (e.g. imports)\n');
}
