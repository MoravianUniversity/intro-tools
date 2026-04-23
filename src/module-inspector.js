/**
 * Functions for setting up and managing the module inspector that displays
 * when no function is selected.
 */

import { wrapWithLabel, makeCheckbox, makeTextarea, makeReadOnlySelect, makeCodeEditorWithShowCheckbox, makeProblemsDiv, isReadOnly } from './inspector.js';
import { DEFAULT_PROGRAM_HEADER } from './save-load.js';
import { makeAddButton, makeRemoveButton } from './utils.js';

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
        makeAuthorNames(model, options, funcs),
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
    info.innerHTML = 'Select a function to edit it.<br>Edit program-wide settings here.';
    return [title, info];
}

function makeModuleDesc(funcs) {
    return makeTextarea('documentation', funcs,
        {placeholder: DEFAULT_PROGRAM_HEADER, required: true});
}

function makeAuthorNames(model, options, funcs) {
    const container = document.createElement('div');
    container.className = 'func-authors';
    if (options.canClaimFuncs) {
        container.classList.add('func-authors-claimable');
    }

    const list = document.createElement('div');
    list.className = 'func-authors-list';

    const label = document.createElement('label');
    label.textContent = 'By:';
    label.id = 'func-authors-label';

    let readOnly = false;

    function currentValues() {
        return [...list.getElementsByTagName('input')].map((input) => input.value.trim());
    }

    function set(input, newName) {
        const index = [...list.getElementsByTagName('input')].indexOf(input);
        const oldName = model.modelData.get('authors')?.get(index)?.toString() || '';
        funcs.set(`authors[${index}]`, newName, input.selectionStart);
        model.functions.forEach((func) => {
            if (func.get('owner')?.toString() === oldName) {
                if (!newName) {
                    func.delete('owner');
                } else {
                    func.set('owner', newName);
                }
            }
        });
    }

    function makeAuthorRow(name) {
        const row = document.createElement('div');
        row.className = 'func-author-row';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Author name...';
        input.value = name;
        input.readOnly = readOnly;
        input.ariaLabelledByElements = [label];
        input.addEventListener('input', () => {
            if (input.value.startsWith(' ')) {
                input.value = input.value.trimStart();
            }
            if (input.value.length > 0 && input.value[0] === input.value[0].toLowerCase()) {
                input.value = input.value[0].toUpperCase() + input.value.slice(1);
            }
            set(input, input.value);
        });

        row.append(input, makeRemoveButton(() => {
            set(input, null);
            if (list.childElementCount === 1) {
                input.value = '';
            } else {
                row.remove();
            }
        }));

        return row;
    }

    container.append(list, makeAddButton(() => {
        const empty = currentValues().indexOf('');
        if (empty !== -1) {
            list.children[empty].querySelector('input').focus();
        } else {
            list.appendChild(makeAuthorRow(''));
            list.lastElementChild.querySelector('input').focus();
        }
    }));

    funcs.listen('authors', (value) => {
        const names = (value && value.length > 0) ? value.map((v) => v.trim()) : [''];
        const current = currentValues();
        if (current.length !== names.length || current.some((name, index) => name !== names[index])) {
            const selected = list.querySelector('input:focus')?.value;
            list.replaceChildren(...names.map(name => makeAuthorRow(name)));
            if (selected != null) { list.querySelector(`input[value="${selected}"]`)?.focus(); }
        }
    });
    funcs.listenRO('authors', (value) => {
        readOnly = value;
        container.classList.toggle('func-authors-read-only', readOnly);
        for (const input of list.getElementsByTagName('input')) { input.readOnly = readOnly; }
    });

    // Cannot use wrapWithLabel here because there are multiple inputs
    const outer = document.createElement('div');
    outer.append(label, container);
    return outer;

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
