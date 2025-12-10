/**
 * This file contains the code for the function planner tool.
 * 
 * Next:
 *  - how to properly save module-level settings?
 *
 * Future ideas:
 *  - better display of the first line of the function (make it look like Python, text boxes that auto-resize)
 *  - some intiial model settings propagate into in-progress model without resetting? (i.e. new functions, into read-only functions, etc)
 *  - a few less parentheses in the type editor string generation (and can dicts nest?)
 *  - server side saving and loading of plans, collaboration, instructor side of things
 */

import go from 'gojs';

import { AvoidsLinksRouter } from './src/AvoidsLinksRouter.js';

import { makeNameEditor } from './src/name-editor.js';
import { makeAllButtons } from './src/buttons.js';
import { setupSaveLoad, pythonDefLine } from './src/save-load.js';
import { setupProblemChecking, updateAllProblems, willFuncBecomeRecursive } from './src/problem-checker.js';
import { setupInspector } from './src/inspector.js';
import { showFunctionInspector } from './src/function-inspector.js';
import { showModuleInspector } from './src/module-inspector.js';
import { ALLOW_RECURSIVE, SHOW_COLLAPSE_BUTTON } from './src/settings.js';

const BASIC_MODEL = {
    documentation: '',
    testDocumentation: '',
    globalCode: '',
    readOnly: false,
    functions: [{ key: 1, name: 'main' },],
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

    const {
        title,
        initialModel,
        allowedTypes,
        minFunctions=1,
        minTestable=0,
        minModuleDescLength=25,
        minFuncDescLength=20,
        minParamDescLength=10,
        minReturnDescLength=10,
        adminMode=false,
        callGraphOnly=false,
    } = options;

    rootElem.classList.add("func-planner");
    const diagramDiv = document.createElement("div");
    diagramDiv.className = "diagram";
    rootElem.appendChild(diagramDiv);

    const diagram = new go.Diagram(diagramDiv, {
        allowCopy: false,
        allowMove: false,
        allowSelect: true,
        allowDelete: true,
        initialAutoScale: go.AutoScale.Uniform,
        defaultScale: 1.5,
        padding: 125,
        maxSelectionCount: 1,
        layout: new go.LayeredDigraphLayout({ direction: 90, layerSpacing: 50, columnSpacing: 30 }),
        'undoManager.isEnabled': true,
        'toolManager.hoverDelay': 200,
        'toolManager.toolTipDuration': 1e10,
    });
    diagram.planId = planId;
    diagram.allowedTypes = allowedTypes ?? DEFAULT_ALLOWED_TYPES;
    diagram.initialModel = initialModel ?? BASIC_MODEL;
    diagram.minFunctions = minFunctions;
    diagram.minTestable = minTestable;
    diagram.minModuleDescLength = minModuleDescLength;
    diagram.minFuncDescLength = minFuncDescLength;
    diagram.minParamDescLength = minParamDescLength;
    diagram.minReturnDescLength = minReturnDescLength;
    diagram.adminMode = adminMode;
    diagram.callGraphOnly = callGraphOnly;

    // Define themes
    diagram.themeManager.set('light', {
        colors: {
            text: '#111827',
            stroke: '#111827',
            'stroke-error': '#dc2626',
            'stroke-warning': '#f59e0b',
            shadow: '#9ca3af',
            'selection': '#0ea5e9',
            'selection-trans': 'rgba(14, 165, 233, 0.5)',

            // background colors for nodes based on user I/O and testability
            'bg-testable': '#090',
            'bg-validation': '#f60',
            'bg-input': '#f90',
            'bg-output': '#09f',
            'bg-indirect': '#d1d5db',
            'bg-none': '#d1d5db',
            'bg-undefined': '#ff0000', // for debugging
        },
        fonts: {
            text: "14px 'Monaco', 'Menlo', 'Ubuntu Mono', monospace", // 0.875rem - using a rem unit messes up rendering
            title: '2.5rem InterVariable, sans-serif',
        }
    });
    diagram.themeManager.set('dark', {
        colors: {
            text: '#f3f4f6',
            stroke: '#f3f4f6',
            shadow: '#6b7280',
            'bg-indirect': '#374151',
            'bg-none': '#374151',
        }
    });

    function strokeColor(problems) {
        return problems.some(p => p[0] === 'error') ? 'stroke-error' : (problems.length > 0 ? 'stroke-warning' : 'stroke');
    }
    function strokeColor2(ps, o) {
        return strokeColor((o.part.data.problems || []).concat(o.part.data.linkProblems || []));
    }

    // Node template
    diagram.nodeTemplate = new go.Node('Spot', {
        locationSpot: go.Spot.Center,
        isShadowed: true,
        shadowOffset: new go.Point(0, 2),
        selectionObjectName: 'BODY',
        toolTip: createToolTip(rootElem),

        // hide the expand/collapse button when not selected or hovered
        mouseEnter: (e, node) => ((node.findObject('BUTTON_EXPAND') ?? {}).opacity = 1),
        mouseLeave: (e, node) => ((node.findObject('BUTTON_EXPAND') ?? {}).opacity = node.isSelected ? 1 : 0),
    }).add(
        new go.Panel("Auto", { name: 'BODY' }).add(
            new go.Shape('RoundedRectangle', {
                name: 'SHAPE',
                strokeWidth: 2,
                cursor: 'crosshair',
                portId: '',
                fromLinkable: true, fromLinkableSelfNode: true, fromLinkableDuplicates: false,
                toLinkable: true, toLinkableSelfNode: true, toLinkableDuplicates: false,
            })
                .theme('fill', 'bg-none')
                .themeData('fill', 'testable', null, (t, o) => t ? 'bg-testable' : `bg-${o.part.data.io || 'none'}`)
                .themeData('fill', 'io', null, (io, o) => o.part.data.testable ? 'bg-testable' : `bg-${io || 'none'}`)
                .themeData('stroke', 'problems', null, strokeColor2)
                .themeData('stroke', 'linkProblems', null, strokeColor2)
                .bind('fromLinkable', 'readOnly', (ro) => !isCallsOutOfRO(ro))
                .bind('cursor', 'readOnly', (ro) => isCallsOutOfRO(ro) ? 'pointer' : 'crosshair')
                .bind('toLinkable', 'readOnly', (ro) => !isCallsIntoRO(ro)),
            makeNameEditor()
        ),
    )
    .theme('shadowColor', 'shadow')
    .bindObject('layerName', 'isSelected', (sel) => (sel ? 'Foreground' : ''))
    .bind('deletable', 'readOnly', (ro) => !ro); // if any property is readOnly, the node is not deletable
    if (SHOW_COLLAPSE_BUTTON) {
        diagram.nodeTemplate.add(go.GraphObject.build('TreeExpanderButton', {
            alignment: go.Spot.Bottom,
            alignmentFocus: go.Spot.Center,
            _treeExpandedFigure: 'LineUp',
            _treeCollapsedFigure: 'LineDown',
            name: 'BUTTON_EXPAND',
            opacity: 0
        }).bindObject('opacity', 'isSelected', (s) => (s ? 1 : 0)));
        //.bindTwoWay('isTreeExpanded')
    }

    // Link template
    diagram.linkTemplate = new go.Link({
        toShortLength: 3,
        relinkableFrom: true,
        relinkableTo: true,
        deletable: true,
        routing: go.Routing.Orthogonal, // maybe Normal or AvoidsNodes may be better?
        // curve: go.Link.Bezier,
        // smoothness: 0.1,
        corner: 10,
        layerName: 'Background',
        doubleClick: (e, link) => {
            // Reverse the link direction on double-click
            const from = link.fromNode;
            const to = link.toNode;
            // TODO: more checks? link already exists? recursive?
            if (isCallsIntoRO(from.data.readOnly) || isCallsOutOfRO(to.data.readOnly)) { return false; }
            diagram.startTransaction('reverse link');
            link.fromNode = to;
            link.toNode = from;
            diagram.commitTransaction('reverse link');
            updateAllProblems(diagram);
        },
    }).add(
        new go.Shape({ strokeWidth: 2 }).themeData('stroke', 'linkProblems', null, strokeColor),
        new go.Shape({ toArrow: 'Standard', scale: 1.4, stroke: null })
            .themeData('fill', 'linkProblems', null, strokeColor)
    );
    // TODO: make the vertical links work better with the LayeredDigraphLayout
    const router = new AvoidsLinksRouter();
    router.linkSpacing = 10;
    diagram.routers.add(router);
    diagram.toolManager.relinkingTool.fromHandleArchetype = new go.Shape('Diamond',
        { width: 12, height: 12, segmentIndex: 0, cursor: 'pointer' }).theme('fill', 'selection-trans');
    diagram.toolManager.relinkingTool.toHandleArchetype = new go.Shape('Diamond',
        { width: 12, height: 12, segmentIndex: -1, cursor: 'pointer' }).theme('fill', 'selection-trans');

    // Link validation
    function linkValidator(fromNode, fromPort, toNode, toPort, link) {
        if (isCallsIntoRO(toNode.data.readOnly)) { return false; }
        if (isCallsOutOfRO(fromNode.data.readOnly)) { return false; }
        if (link && link.fromNode !== fromNode && isCallsIntoRO(link.fromNode.data.readOnly)) { return false; }
        if (link && link.toNode !== toNode && isCallsOutOfRO(link.toNode.data.readOnly)) { return false; }
        if (!ALLOW_RECURSIVE && willFuncBecomeRecursive(diagram, fromNode, toNode)) { return false; }
        return true;
    }
    diagram.toolManager.linkingTool.linkValidation = linkValidator;
    diagram.toolManager.relinkingTool.linkValidation = linkValidator;
    diagram.commandHandler.canDeleteSelection = () => !diagram.selection.any(part =>
        (part instanceof go.Link) && (isCallsOutOfRO(part.fromNode.data.readOnly) || isCallsIntoRO(part.toNode.data.readOnly))
    );

    // Initialize the model
    setupSaveLoad(diagram);

    // Add all of the extra UI elements
    if (title) {
        diagram.add(new go.Part({ layerName: "ViewportBackground", alignment: go.Spot.Top })
            .add(new go.TextBlock(title, {margin: 20}).theme('font', 'title').theme('stroke', 'text')));
    }
    makeAllButtons(diagram);
    setupProblemChecking(diagram);

    // Show the appropriate inspector based on selection
    if (!diagram.callGraphOnly) {
        const inspectorDiv = setupInspector(diagram);
        diagram.addDiagramListener('ChangedSelection', (e) => {
            let subject = e.subject.first();
            if (subject instanceof go.Link) {
                return; // keep same
                //subject = subject.fromNode; // show the fromNode of the link
                //showModuleInspector(diagram, inspectorDiv); // show module inspector
            }
            if (!subject) {
                showModuleInspector(diagram, inspectorDiv);
            } else {
                showFunctionInspector(diagram, inspectorDiv, subject);
            }
        });
        showModuleInspector(diagram, inspectorDiv);
    }
}

function createToolTip(rootElem) {
    function genToolTip(data) {
        let text = '<code>' + pythonDefLine(data.name || `function${data.key}`, data.params || [], data.returns || [], true, true) + '</code>';
        const problems = (data.problems || []).concat(data.linkProblems || []);
        if (problems.length > 0) {
            text += "<ul class='problems'>";
            for (const [type, field, message] of problems) { text += `<li class="${type}">${message}</li>`; }
            text += "</ul>";
        }
        return text;
    }
    const toolTipElem = document.createElement('div');
    toolTipElem.className = 'tooltip-content';
    toolTipElem.style.display = 'none';
    rootElem.appendChild(toolTipElem);
    return new go.HTMLInfo({
        mainElement: toolTipElem,
        show: (obj, diagram, tool) => {
            const pos = diagram.transformDocToView(obj.part.findObject('SHAPE').getDocumentPoint(go.Spot.BottomLeft));
            toolTipElem.style.left = `${pos.x}px`;
            toolTipElem.style.top = `${pos.y + 10}px`;
            const text = genToolTip(obj.part.data);
            toolTipElem.innerHTML = text;
            toolTipElem.style.display = 'block';
            return toolTipElem;
        },
        hide: (diagram, tool) => { toolTipElem.style.display = 'none'; },
    });
}

function isCallsIntoRO(ro) {
    return ro === true || (Array.isArray(ro) && (ro.includes('callsInto') || ro.includes('calls')));
}

function isCallsOutOfRO(ro) {
    return ro === true || (Array.isArray(ro) && (ro.includes('callsOutOf') || ro.includes('calls')));
}
