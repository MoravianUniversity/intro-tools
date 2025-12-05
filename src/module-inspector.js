/**
 * Functions for setting up and managing the module inspector that displays
 * when no function is selected.
 */

import { wrapWithLabel, makeCheckbox, makeTextarea, makeReadOnlySelect, makeCodeEditorWithShowCheckbox, updateProblemsInInspector } from './inspector.js';
import { modelProblems } from './problem-checker.js';
import { DEFAULT_PROGRAM_HEADER } from './save-load.js';

export function showModuleInspector(diagram, inspectorDiv) {
    const data = diagram.model;

    function updateProblems(fix = false, key = null) {
        const problems = modelProblems(diagram);
        data.problems = problems; // TODO: diagram.model.setDataProperty(data, 'problems', problems);
        updateProblemsInInspector(inspectorDiv, problems);
    }

    function setValue(key, value, fix=false) {
        data[key] = value; // TODO: diagram.model.setDataProperty(data, key, value);
        updateProblems(fix, key);
    }

    function set(key, value) {
        // TODO: diagram.commit((d) => { ... }, `${key} changed`);
        if (data[key] !== value) { setValue(key, value, true); }
    }

    let currentTransaction = null;
    function update(key, value, fix = false) {
        if (data[key] !== value || fix) {
            // make sure there is a transaction in progress
            if (currentTransaction !== key) {
                // TODO:
                //if (currentTransaction) { diagram.commitTransaction(`${currentTransaction} changed`); }
                //diagram.startTransaction(`${key} changed`);
                currentTransaction = key;
            }

            // update the value
            setValue(key, value, fix);
        }
    }
    function end(key, value) {
        update(key, value, true);
        if (currentTransaction === key) {
            // TODO: diagram.commitTransaction(`${key} changed`);
            currentTransaction = null;
        }
    }

    inspectorDiv.innerHTML = '';
    makeHeader(diagram, inspectorDiv);
    inspectorDiv.appendChild(makeModuleDesc(diagram, data, update, end));
    inspectorDiv.appendChild(makeAuthorNames(diagram, data, update, end));
    const hasTestable = diagram.model.nodeDataArray.some(n => n.testable);
    if (hasTestable && (diagram.showTestDocumentation || diagram.adminMode)) {
        inspectorDiv.appendChild(makeTestDocumentation(diagram, data, update, end));
        if (diagram.adminMode) {
            inspectorDiv.appendChild(makeShowTestDocumentationCheckbox(diagram, data, set));
        }
    }
    makeCodeEditorWithShowCheckbox(inspectorDiv, diagram, data, 'globalCode', update, end, set,
        'Global Code', '# Write your module-level code here (e.g. imports)\n');
    if (diagram.adminMode) {
        inspectorDiv.appendChild(makeReadOnlySelect(diagram, data, set,
            ['documentation', 'testDocumentation', 'globalCode']));
    }
    const problemsDiv = document.createElement('div');
    problemsDiv.className = 'problems';
    inspectorDiv.appendChild(problemsDiv);
    updateProblems();
}

function makeHeader(diagram, inspectorDiv) {
    const title = document.createElement('h2');
    title.textContent = (diagram.planId || 'Module');
    inspectorDiv.appendChild(title);
    const info = document.createElement('p');
    info.textContent = 'Select a function to edit it.\nEdit program-wide settings here.';
    inspectorDiv.appendChild(info);
}

function makeModuleDesc(diagram, data, update, end) {
    const textarea = makeTextarea(diagram, data, 'documentation', update, end, DEFAULT_PROGRAM_HEADER);
    textarea.required = true;
    return textarea;
}

function makeAuthorNames(diagram, data, update, end) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'func-authors';
    input.placeholder = 'Authors...';
    input.value = data.authors || '';
    input.required = true;
    input.addEventListener('input', (e) => { update('authors', e.target.value); });
    input.addEventListener('blur', (e) => { end('authors', e.target.value); });
    return wrapWithLabel(input, 'By:');
}

function makeTestDocumentation(diagram, data, update, end) {
    return wrapWithLabel(
        makeTextarea(diagram, data, 'testDocumentation', update, end, "Tests for the " + diagram.planId + " module"),
        'Test Documentation'
    );
}

function makeShowTestDocumentationCheckbox(diagram, data, set) {
    return wrapWithLabel(makeCheckbox(diagram, data, 'showTestDocumentation', set), 'Show Test Documentation: ');
}
