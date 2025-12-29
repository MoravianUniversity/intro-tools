/**
 * This file contains the code for the function planner tool.
 * 
 * Future ideas:
 *  - some initial model settings propagate into in-progress model without resetting? (i.e. new functions, into read-only functions, etc)
 *  - a few less parentheses in the type editor string generation (and can dicts nest?)
 *  - server side saving and loading of plans, collaboration, instructor side of things
 */

import go from 'gojs';

import { makeAllButtons } from './src/buttons.js';
import { Model } from './src/model.js';
import { setupDiagram } from './src/diagram.js';
import { setupDragAndDrop } from './src/save-load.js';
import { setupProblemChecking } from './src/problem-checker.js';
import { setupInspector } from './src/inspector.js';
import { makeFunctionInspector } from './src/function-inspector.js';
import { makeModuleInspector } from './src/module-inspector.js';

import './function-planner.css';

const BASIC_MODEL = {
    functions: [{ key: "1", name: 'main' },],
    calls: []
};
const DEFAULT_ALLOWED_TYPES = ['int', 'float', 'str', 'bool', 'list', 'tuple', 'dict', 'set'];

/**
 * Initialize the Function Planner in the given root element.
 * @param {HTMLElement|string} rootElem
 * @param {string} planId - Unique identifier for the plan (used for saving in localStorage)
 * @param {object} options - Additional options
 * @param {string} options.title - Title to show at the top of the diagram, optional
 * @param {object} options.initialModel - Initial model to load if no saved model exists, defaults to a basic plan with a single "main" function
 * @param {string[]} options.allowedTypes - List of allowed types for function parameters and returns
 * @param {number} options.minFunctions - Minimum number of functions required (for validation), defaults to 1
 * @param {number} options.minTestable - Minimum number of testable functions required (for validation), defaults to 0
 * @param {number} options.minModuleDescLength - Minimum length of module description (for validation), defaults to 25
 * @param {number} options.minFuncDescLength - Minimum length of function description (for validation), defaults to 20
 * @param {number} options.minParamDescLength - Minimum length of parameter description (for validation), defaults to 10
 * @param {number} options.minReturnDescLength - Minimum length of return description (for validation), defaults to 10
 * @param {boolean} options.adminMode - If true, enables admin mode features (nothing is read-only or not shown, allows editing read-only properties)
 * @param {boolean} options.callGraphOnly - If true, hides the module and function inspectors, only shows the call graph (and suppresses most problem checking)
 */
export default function init(
    rootElem,
    planId,
    options={},
) {
    rootElem = typeof rootElem === 'string' ? document.getElementById(rootElem) : rootElem;
    rootElem.classList.add("func-planner");

    options = { ...options };
    options.title = options.title || null;
    options.initialModel = options.initialModel ?? BASIC_MODEL;
    options.allowedTypes = options.allowedTypes ?? DEFAULT_ALLOWED_TYPES;
    options.adminMode = options.adminMode ?? false;
    options.callGraphOnly = options.callGraphOnly ?? false;
    options.theme = localStorage.getItem('func-planner-theme') === 'dark' ? 'dark' : 'light';

    const model = new Model(planId, options.initialModel);
    const diagram = setupDiagram(rootElem, model, options);
    makeAllButtons(diagram, model, options);
    setupDragAndDrop(model, options, diagram.div); // TODO: only if not connected to shared Yjs model
    setupProblemChecking(model, options);

    // Show the appropriate inspector based on selection
    if (!options.callGraphOnly) {
        const inspectorDiv = setupInspector(diagram.div);
        const moduleInspector = makeModuleInspector(model, options);
        const [funcInspector, setFuncInspectorKey] = makeFunctionInspector(model, options);
        inspectorDiv.append(moduleInspector, funcInspector);
        funcInspector.style.display = 'none';
        diagram.addDiagramListener('ChangedSelection', (e) => {
            let subject = e.subject.first();
            if (!subject) {
                moduleInspector.style.display = '';
                funcInspector.style.display = 'none';
            } else if (subject instanceof go.Link) {
                return; // keep same
                // or could show the fromNode in function inspector or revert to module inspector
            } else {
                setFuncInspectorKey(subject.data.key);
                moduleInspector.style.display = 'none';
                funcInspector.style.display = '';
            }
        });
    }
}
