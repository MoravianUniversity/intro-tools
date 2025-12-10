/**
 * Tools for editing function names directly in a GoJS diagram.
 */

import go from 'gojs';

import { funcProblems, linkProblems, funcLinkProblems, modelProblems, checkName, isFunctionNameNotUnique } from './problem-checker.js';
import { isReadOnly } from './inspector.js';

/**
 * Creates and returns a name editor panel for a function node.
 * @returns {go.Panel} The name editor panel.
 */
export function makeNameEditor() {
    return new go.Panel("Horizontal", { type: go.Panel.Horizontal, margin: new go.Margin(10, 6, 6, 6) }).add(
        new go.TextBlock("", {
            isMultiline: false,
            cursor: 'pointer',
            editable: true,
            textEditor: functionNameEditor(),
            textEdited: handleNameEdited,
        }).theme('stroke', 'stroke').theme('font', 'text')
            .bindTwoWay('text', 'name',
                (name, tb) => name || `function${tb.part.data.key}`,
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
function handleNameEdited(tb, oldText, newText) {
    const diagram = tb.diagram;
    const data = tb.part.data;
    if (isBlankFunctionName(oldText) && isBlankFunctionName(newText)) {
        // empty -> empty doesn't trigger a proper change and causes an issue in the UI so we have to force it
        const model = diagram.model;
        model.setDataProperty(data, 'name', "<temporary>");
        model.setDataProperty(data, 'name', "");
    }
    updateProblemsForName(diagram, data);
}

/**
 * Updates the problems for a function name change and its related links.
 * @param {*} diagram 
 * @param {object} data The function node data
 */
function updateProblemsForName(diagram, data) {
    const model = diagram.model;
    // get the problems for this function
    const problems = funcProblems(data, diagram);
    // recheck the link problems since "main" is special
    const node = diagram.findNodeForData(data);
    model.setDataProperty(data, 'linkProblems', funcLinkProblems(node));
    for (const link of node.findLinksConnected()) {
        model.setDataProperty(link.data, 'linkProblems', linkProblems(link));
    }
    modelProblems(diagram);  // recheck the model problems since it checks if there is a "main"
    model.setDataProperty(data, 'problems', problems);
}

/**
 * Checks if a function name is considered blank/default.
 * @param {string} name 
 * @returns {boolean} True if the function name is blank or default, false otherwise
 */
function isBlankFunctionName(name) {
    return !name || name.trim() === '' || /^(function|fun|func)(\d+)?$/.test(name.trim());
}

/**
 * Creates and returns a function name editor for GoJS.
 * @returns {go.HTMLInfo} The function name editor.
 */
function functionNameEditor() {
    const editor = new go.HTMLInfo();
    const div = document.createElement('div');
    div.className = 'function-name-editor';
    const input = document.createElement('input');
    input.required = true;
    input.pattern = '[a-zA-Z_][a-zA-Z0-9_]*';
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
        const name = input.value;
        const problem = checkName(name);
        if (problem) {
            div.classList.add(problem[0]);
            div.title = problem[2];
        } else if (isFunctionNameNotUnique(name, activeDiagram, activeTextBlock.part.data.name === name)) {
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
        const data = textBlock.part.data;
        if (!(textBlock instanceof go.TextBlock)) { return; }
        activeTextBlock = textBlock;
        activeDiagram = diagram;
        activeTool = tool;
        input.readOnly = !diagram.adminMode && isReadOnly(data, 'name', diagram);
        input.placeholder = `function${data.key}`;
        input.value = data.name;
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
