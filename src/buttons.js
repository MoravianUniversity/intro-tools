/**
 * Functions for creating buttons in the function planner UI. Also includes
 * functions for managing the info box and settings.
 */

import Swal from 'sweetalert2';

import { reset, exportToPython, exportPythonTests, saveJSON, loadJSON, importJSON } from './save-load.js';
import { setSettings, SHOW_COLLAPSE_BUTTON, ALLOW_RECURSIVE } from './settings.js';
import { loadSVG, htmlToNode, isMacOS } from './utils.js';

export const INFO_BOX_CLASS_NAME = 'func-planner-info-box';
export const MAIN_CHECK_CLASS_NAME = 'func-planner-main-check';
export const NUM_COUNT_CLASS_NAME = 'func-planner-count';
export const NUM_TESTABLE_CLASS_NAME = 'func-planner-testable';

/**
 * Create all of the buttons and UI elements for the diagram.
 * @param {*} diagram
 */
export function makeAllButtons(diagram) {
    makeSettingsButton(diagram);
    makeThemeToggle(diagram);
    makeInstructionsButton(diagram);
    makeWidgetButtons(diagram);
    makeInfoBox(diagram);
}

function makeWidgetButtons(diagram) {
    const isMac = isMacOS()
    const ctrl = isMac ? '⌘' : 'CTRL+';

    const widgets = document.createElement('div');
    widgets.className = 'func-planner-widgets';
    diagram.div.parentNode.appendChild(widgets);

    const holder = document.createElement('div');
    holder.className = 'button-holder';
    widgets.appendChild(holder);

    function addFunction() {
        let key = diagram.model.nodeDataArray.length + 1;
        while (diagram.model.findNodeDataForKey(key)) { key++; } // ensure unique key
        diagram.model.addNodeData({
            key: key, name: '', desc: '',
            params: [], returns: [], io: "none",
            readOnly: false, testable: false,
        });
    }

    addButton(holder, 'magnifier.svg', '', `Zoom to Fit (${ctrl}R)`, () => { diagram.zoomToFit(); });
    addButton(holder, 'add.svg', 'no-outline', `Add Function (${ctrl}F)`, () => { addFunction(); });

    document.addEventListener('keydown', (e) => {
        if ((isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey) {
            const key = e.key.toLowerCase();
            if (key === 'r') {
                e.preventDefault();
                diagram.zoomToFit();
            } else if (key === 'f') {
                e.preventDefault();
                addFunction();
            }
        }
    });

    const undoButton = addButton(holder, 'undo.svg', 'no-outline', `Undo (${ctrl}Z)`, () => { if (diagram.undoManager.canUndo()) { diagram.undoManager.undo(); } });
    undoButton.disabled = !diagram.undoManager.canUndo();
    diagram.addModelChangedListener((e) => {
        if (e.isTransactionFinished) {
            undoButton.disabled = !diagram.undoManager.canUndo() || diagram.undoManager.transactionToUndo.name === 'Initial Layout';
        }
    });

    addButton(holder, 'reset.svg', 'no-outline', `Reset`, () => { reset(diagram); });

    addButton(holder, 'python.svg', '', 'Create Python Template', () => { exportToPython(diagram); });
    const testButton = addButton(holder, 'unit-tests.svg', '', 'Generate Python Unit Tests', () => { exportPythonTests(diagram); });
    diagram.addModelChangedListener((e) => {
        if (e.isTransactionFinished) {
            testButton.disabled = diagram.model.nodeDataArray.every(n => !n.testable);
        }
    });
    addButton(holder, 'save.svg', 'no-outline', 'Save as JSON', () => { saveJSON(diagram); });
    addButton(holder, 'load.svg', 'no-outline', 'Load from JSON', () => { loadJSON(diagram); });
    addButton(holder, 'merge.svg', 'no-outline', 'Merge from JSON', () => { importJSON(diagram); });
}

function addButton(holder, icon, classes, name, callback) {
    const button = document.createElement('button');
    let img;
    if (icon.toLowerCase().endsWith('.svg')) {
        img = document.createElement('div');
        loadSVG(`images/${icon}`, img, "");
    } else {
        img = document.createElement('img');
        img.src = `images/${icon}`;
    }
    img.classList = classes + " func-planner-icon";
    button.appendChild(img);
    const span = document.createElement('span');
    span.innerText = name;
    button.appendChild(span);
    button.addEventListener('click', callback);
    holder.appendChild(button);
    return button;
}

function makeThemeToggle(diagram) {
    const link = document.createElement("link");
    link.type = "text/css";
    link.rel = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/npm/theme-toggles@4.10.1/css/within.min.css";
    document.head.appendChild(link);

    const checked = localStorage.getItem('func-planner-theme') === 'dark';
    const button = htmlToNode(`
<label class="func-planner-fab theme-toggle" title="Toggle theme">
  <input type="checkbox" ${checked ? 'checked' : ''} />
  <span class="theme-toggle-sr">Toggle theme</span>
  <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="theme-toggle__within" height="1em" width="1em" viewBox="0 0 32 32" fill="currentColor">
    <clipPath id="theme-toggle__within__clip"><path d="M0 0h32v32h-32ZM6 16A1 1 0 0026 16 1 1 0 006 16" /></clipPath>
    <g clip-path="url(#theme-toggle__within__clip)">
      <path d="M30.7 21.3 27.1 16l3.7-5.3c.4-.5.1-1.3-.6-1.4l-6.3-1.1-1.1-6.3c-.1-.6-.8-.9-1.4-.6L16 5l-5.4-3.7c-.5-.4-1.3-.1-1.4.6l-1 6.3-6.4 1.1c-.6.1-.9.9-.6 1.3L4.9 16l-3.7 5.3c-.4.5-.1 1.3.6 1.4l6.3 1.1 1.1 6.3c.1.6.8.9 1.4.6l5.3-3.7 5.3 3.7c.5.4 1.3.1 1.4-.6l1.1-6.3 6.3-1.1c.8-.1 1.1-.8.7-1.4zM16 25.1c-5.1 0-9.1-4.1-9.1-9.1 0-5.1 4.1-9.1 9.1-9.1s9.1 4.1 9.1 9.1c0 5.1-4 9.1-9.1 9.1z" />
    </g>
    <path
      class="theme-toggle__within__circle"
      d="M16 7.7c-4.6 0-8.2 3.7-8.2 8.2s3.6 8.4 8.2 8.4 8.2-3.7 8.2-8.2-3.6-8.4-8.2-8.4zm0 14.4c-3.4 0-6.1-2.9-6.1-6.2s2.7-6.1 6.1-6.1c3.4 0 6.1 2.9 6.1 6.2s-2.7 6.1-6.1 6.1z"
    />
    <path
      class="theme-toggle__within__inner"
      d="M16 9.5c-3.6 0-6.4 2.9-6.4 6.4s2.8 6.5 6.4 6.5 6.4-2.9 6.4-6.4-2.8-6.5-6.4-6.5z"
    />
  </svg>
</label>`);
    diagram.div.parentNode.appendChild(button);
    const toggle = button.querySelector('input[type="checkbox"]');
    diagram.themeManager.currentTheme = checked ? 'dark' : 'light';
    diagram.div.parentNode.classList.toggle('dark-mode', checked);
    toggle.addEventListener('change', (e) => {
        localStorage.setItem('func-planner-theme', e.target.checked ? 'dark' : 'light');
        diagram.themeManager.currentTheme = e.target.checked ? 'dark' : 'light';
        diagram.div.parentNode.classList.toggle('dark-mode', e.target.checked);
    });
}

function makeSettingsButton(diagram) {
    const button = document.createElement('div');
    button.className = 'func-planner-fab func-planner-settings-button';
    button.title = 'Settings';
    loadSVG('images/settings.svg', button, "⚙️");
    diagram.div.parentNode.appendChild(button);

    button.addEventListener('click', () => {
        Swal.fire({
            theme: diagram.themeManager.currentTheme,
            title: 'Function Planner Settings',
            html: `<div class="func-planner-settings">
  <label><span>Show Collapse Button:</span><input type="checkbox" class="show-collapse-button" ${SHOW_COLLAPSE_BUTTON ? 'checked' : ''}></label><br>
  <label><span>Allow Recursive Calls:</span><input type="checkbox" class="allow-recursive" ${ALLOW_RECURSIVE ? 'checked' : ''}></label>
</div>`,
            showCancelButton: true,
        }).then((result) => {
            if (result.isConfirmed) {
                const popup = Swal.getPopup();
                const showCollapseButton = popup.getElementsByClassName('show-collapse-button')[0].checked;
                const allowRecursive = popup.getElementsByClassName('allow-recursive')[0].checked;
                setSettings(showCollapseButton, allowRecursive);
            }
        });
    });
}

function makeInstructionsButton(diagram) {
    const button = document.createElement('div');
    button.className = 'func-planner-fab func-planner-instructions-button';
    button.title = 'Instructions';
    loadSVG('images/help.svg', button, "ℹ️");
    diagram.div.parentNode.appendChild(button);
    diagram.div.parentNode.appendChild(htmlToNode(`<div class="func-planner-instructions"><h2>Instructions</h2>
<p>The diagram shows the functions and who they call. Clicking on a function
will show its details on the right and allow you to edit it.</p>
<p>As you edit the functions, the diagram will update to show any problems.
Errors are shown with a <span class="stroke-error">red</span> outline and less
serious warnings with a <span class="stroke-warning">yellow</span> outline.</p>
<p>The color of a function indicates its user I/O type:</p>
<ul>
    <li><span class="bg-testable">Testable</span> - can be tested with a test case</li>
    <li><span class="bg-validation">Validated Input</span> - has user input with validation</li>
    <li><span class="bg-input">Basic Input</span> - has basic user input</li>
    <li><span class="bg-output">Output Only</span> - has user output but no direct user input</li>
    <li><span class="bg-none">None / Indirect</span> - no user I/O itself, but may call functions which do</li>
</ul>
<p>The buttons on the left allow you to add functions, generate a Python
template, save the diagram, and other actions.</p>
<p>To add a new function call, drag from the edge of one function to another.
They can be reconnected as needed. Double-clicking a call will reverse its
direction.</p>
<p>To remove functions or calls, select them and press the delete key.</p></div>`));
}

function makeInfoBox(diagram) {
    const minFunctions = diagram.minFunctions || 1;
    const minTestable = diagram.minTestable || 0;
    const infoBox = document.createElement('div');
    infoBox.className = INFO_BOX_CLASS_NAME;
    infoBox.innerHTML = '<table>' +
        `<tr class="${NUM_COUNT_CLASS_NAME}"><td>Functions:</td><td>0</td><td>/</td><td>${minFunctions}</td></td></tr>` +
        `<tr class="${NUM_TESTABLE_CLASS_NAME}"><td>Testable:</td><td>0</td><td>/</td><td>${minTestable}</td></tr>` +
        `</table><span class="${MAIN_CHECK_CLASS_NAME} value-hidden value-error">Need a main function</span>`;
    diagram.div.parentNode.getElementsByClassName('func-planner-widgets')[0].appendChild(infoBox);
    if (minFunctions <= 1) { infoBox.getElementsByClassName(NUM_COUNT_CLASS_NAME)[0].classList.add('value-hidden'); }
    if (minTestable <= 0) { infoBox.getElementsByClassName(NUM_TESTABLE_CLASS_NAME)[0].classList.add('value-hidden'); }
}
