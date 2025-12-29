/**
 * Tools for editing function names directly in a GoJS diagram.
 */

import go from 'gojs';

import { checkName, isFunctionNameNotUnique } from './problem-checker.js';
import { isReadOnly } from './inspector.js';

/**
 * Creates and returns a name editor panel for a function node.
 * @param {*} model
 * @param {object} options
 * @returns {go.Panel} The name editor panel.
 */
export function makeNameEditor(model, options) {
    return new go.Panel("Horizontal", { type: go.Panel.Horizontal, margin: new go.Margin(10, 6, 6, 6) }).add(
        new go.TextBlock("", {
            isMultiline: false,
            cursor: 'pointer',
            editable: true,
            textEditor: functionNameEditor(model, options),
            textEdited: (tb, oldText, newText) => handleNameEdited(model, tb, oldText, newText),
        }).theme('stroke', 'stroke').theme('font', 'text')
            .bindTwoWay('text', 'name',
                (name, tb) => name || 'function',
                (name, data, model) => {
                    name = name.trim().replace(/[^a-zA-Z0-9_]/g, '_');
                    return isBlankFunctionName(name) ? '' : name;
                }),
        new go.TextBlock("", {
            isMultiline: false,
            editable: false,
            text: '()',
        }).theme('stroke', 'stroke').theme('font', 'text')
    );
}

/**
 * Handles the event when a function name has been edited.
 * @param {*} tb the TextBlock being edited
 * @param {string} oldText the old text
 * @param {string} newText the new text
 */
function handleNameEdited(model, tb, oldText, newText) {
    const data = tb.part.data;
    if (isBlankFunctionName(oldText) && isBlankFunctionName(newText)) {
        // empty -> empty doesn't trigger a proper change and causes an issue in the UI so we have to force it
        tb.diagram.model.setDataProperty(data, 'name', "<temporary>");
        tb.diagram.model.setDataProperty(data, 'name', "");
    }
    model.updateFunc(data.key, 'name', newText);
}

/**
 * Checks if a function name is considered blank/default.
 * @param {string} name 
 * @returns {boolean} True if the function name is blank or default, false otherwise
 */
export function isBlankFunctionName(name) {
    return !name || name.trim() === '' || name.trim() === 'function';
}

/**
 * Creates and returns a function name editor for GoJS.
 * @param {*} model
 * @returns {go.HTMLInfo} The function name editor.
 */
function functionNameEditor(model, options) {
    const editor = new go.HTMLInfo();
    const div = document.createElement('div');
    div.className = 'function-name-editor';
    const input = document.createElement('input');
    // Adding these overrides the titles I provide for errors
    //input.required = true;
    //input.pattern = '[a-zA-Z_][a-zA-Z0-9_]*';
    div.appendChild(input);
    const ghost = document.createElement('span');
    ghost.className = 'ghost';
    div.appendChild(ghost);

    let activeTextBlock = null;
    let activeDiagram = null;
    let activeTool = null;

    function updateText() {
        div.classList.remove('error', 'warning');
        div.title = '';
        const key = activeTextBlock.part.data.key;
        const name = input.value;
        const problem = checkName(name);
        if (problem) {
            div.classList.add(problem[0]);
            div.title = problem[2];
        } else if (isFunctionNameNotUnique(model, key, name)) {
            div.classList.add('error');
            div.title = 'Function name must be unique.';
        }
        ghost.textContent = name || input.placeholder;
    }
    input.addEventListener('input', updateText);

    input.addEventListener('keydown', (e) => {
        if (!activeTool || e.isComposing) { return; }
        const code = e.code;
        if (code === 'Enter') { activeTool.acceptText(go.TextEditingAccept.Enter); } // Accept on Enter
        else if (code === 'Tab') { activeTool.acceptText(go.TextEditingAccept.Tab); e.preventDefault(); } // Accept on Tab
        else if (code === 'Escape') { activeTool.doCancel(); if (activeTool.diagram) activeTool.diagram.focus(); } // Cancel on Esc
    }, false);

    input.addEventListener('blur', (e) => {
        if (activeTool) { activeTool.acceptText(go.TextEditingAccept.LostFocus); } // Accept on losing focus
    });

    function updatePos() {
        if (activeDiagram && activeDiagram.div !== null && div.parentElement === activeDiagram.div) {
            const loc = activeTextBlock.part.getDocumentPoint(go.Spot.TopLeft);
            const pos = activeDiagram.transformDocToView(loc);
            div.style.transform = 'scale(' + activeDiagram.scale + ')';
            div.style.left = pos.x + 'px';
            div.style.top = pos.y + 'px';
            div.style.minWidth = (activeTextBlock.panel.actualBounds.width+3) + 'px';
        }
    }

    editor.show = (textBlock, diagram, tool) => {
        if (!(textBlock instanceof go.TextBlock)) { return; }
        const data = textBlock.part.data;
        activeTextBlock = textBlock;
        activeDiagram = diagram;
        activeTool = tool;
        input.readOnly = isReadOnly(data.readOnly ?? false, 'name');
        input.placeholder = 'function';
        input.value = isBlankFunctionName(data.name) ? '' : data.name;
        div.style.backgroundColor = `color-mix(in srgb, var(--bg-${data.testable ? 'testable' : (data.io || 'none')}-color) 70%, var(--text-color))`;
        updateText();
        if (diagram.div !== null) {
            diagram.div.appendChild(div);
            diagram.addDiagramListener('ViewportBoundsChanged', updatePos);
            updatePos();
        }
        input.focus();
        input.select();
    };

    editor.hide = (diagram, tool) => {
        if (diagram.div !== null) {
            diagram.div.removeChild(div);
            diagram.removeDiagramListener('ViewportBoundsChanged', updatePos);
        }
        activeTextBlock = null;
        activeDiagram = null;
        activeTool = null;
    };

    editor.valueFunction = () => {
        return input.value.trim().replace(/[^a-zA-Z0-9_]/g, '_');
    }
    
    return editor;
}
