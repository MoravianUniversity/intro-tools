/**
 * This file contains the code for the function planner tool.
 * 
 * Future ideas:
 *  - better display of the first line of the function (make it look like Python, text boxes that auto-resize)
 *  - more init options for what should be tested or in the menu
 *  - a few less parentheses in the type editor string generation
 */

// TODO: proper imports? maybe an import map? https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap
//import * as go from 'gojs';
//import Sortable from 'sortablejs';
//import Swal from 'sweetalert2'

import TypeEditor from './type-editor.js';

const IMMUTABLE_TYPES = ['int', 'float', 'str', 'bool', 'tuple'];
const BASIC_PLAN = { functions: [{ key: 1, name: 'main' },], calls: [] };

const DEFAULT_ALLOWED_TYPES = ['int', 'float', 'str', 'bool', 'list', 'tuple', 'dict', 'set'];

export default function init(
    rootElem,
    title=null, planId=null, initialModel=null, allowedTypes=null,
    minFunctions=1, minTestable=0
) {
    rootElem = typeof rootElem === 'string' ? document.getElementById(rootElem) : rootElem;

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
        maxSelectionCount: 1,
        layout: new go.LayeredDigraphLayout({ direction: 90, /*layerSpacing: 25,*/ columnSpacing: 30, }),
        'undoManager.isEnabled': true,
        'toolManager.toolTipDuration': 1e10,
    });
    diagram.allowedTypes = allowedTypes || DEFAULT_ALLOWED_TYPES;
    diagram.planId = planId;
    diagram.initialModel = initialModel || BASIC_PLAN;

    diagram.themeManager.set('light', {
        colors: {
            text: '#111827',
            stroke: '#111827',
            'stroke-error': '#dc2626',
            'stroke-warning': '#f59e0b',
            shadow: '#9ca3af',

            // background colors for nodes based on user I/O and testability
            'bg-testable': '#090',
            'bg-validation': '#f60',
            'bg-input': '#f90',
            'bg-output': '#09f',
            'bg-indirect': '#d1d5db',
            'bg-none': '#d1d5db',
        },
        fonts: {
            text: '14px monospace', // 0.875rem - using a rem unit messes up rendering
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
        mouseEnter: (e, node) => (node.findObject('BUTTON_EXPAND').opacity = 1),
        mouseLeave: (e, node) => (node.findObject('BUTTON_EXPAND').opacity = node.isSelected ? 1 : 0),
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
                .themeData('fill', 'testable', null, (t, o) => t ? 'bg-testable' : `bg-${o.part.data.io}`)
                .themeData('fill', 'io', null, (io, o) => o.part.data.testable ? 'bg-testable' : `bg-${io}`)
                .themeData('stroke', 'problems', null, strokeColor2)
                .themeData('stroke', 'linkProblems', null, strokeColor2)
                .bind('fromLinkable', 'readOnly', (ro) => !isCallsOutOfRO(ro))
                .bind('cursor', 'readOnly', (ro) => isCallsOutOfRO(ro) ? 'pointer' : 'crosshair')
                .bind('toLinkable', 'readOnly', (ro) => !isCallsIntoRO(ro)),
            new go.TextBlock("", {
                isMultiline: false,
                editable: false,
                margin: new go.Margin(10, 6, 6, 6),
                cursor: 'pointer',
            })
                .theme('stroke', 'stroke').theme('font', 'text')
                .bind('text', '', (data) => `${data.name || `function${data.key}`}()`),
        ),
        go.GraphObject.build('TreeExpanderButton', {
            alignment: go.Spot.Bottom,
            alignmentFocus: go.Spot.Center,
            _treeExpandedFigure: 'LineUp',
            _treeCollapsedFigure: 'LineDown',
            name: 'BUTTON_EXPAND',
            opacity: 0
        }).bindObject('opacity', 'isSelected', (s) => (s ? 1 : 0))
    )
    .theme('shadowColor', 'shadow')
    .bindObject('layerName', 'isSelected', (sel) => (sel ? 'Foreground' : ''))
    //.bindTwoWay('isTreeExpanded')
    .bind('deletable', 'readOnly', (ro) => !ro) // if any property is readOnly, the node is not deletable

    diagram.linkTemplate = new go.Link({
        toShortLength: 3,
        relinkableFrom: true,
        relinkableTo: true,
        deletable: true,
        routing: go.Routing.Orthogonal,
        corner: 10,
        layerName: 'Background',
    }).add(
        new go.Shape({ strokeWidth: 2 }).themeData('stroke', 'linkProblems', null, strokeColor),
        new go.Shape({ toArrow: 'Standard', stroke: null }).themeData('fill', 'linkProblems', null, strokeColor),
    );

    function linkValidator(fromNode, fromPort, toNode, toPort, link) {
        if (isCallsIntoRO(toNode.data.readOnly)) { return false; }
        if (isCallsOutOfRO(fromNode.data.readOnly)) { return false; }
        if (link && link.fromNode !== fromNode && isCallsIntoRO(link.fromNode.data.readOnly)) { return false; }
        if (link && link.toNode !== toNode && isCallsOutOfRO(link.toNode.data.readOnly)) { return false; }
        return true;
    }
    diagram.toolManager.linkingTool.linkValidation = linkValidator;
    diagram.toolManager.relinkingTool.linkValidation = linkValidator;
    diagram.commandHandler.canDeleteSelection = () => !diagram.selection.any(part =>
        (part instanceof go.Link) && (isCallsOutOfRO(part.fromNode.data.readOnly) || isCallsIntoRO(part.toNode.data.readOnly))
    );

    const model = (localStorage.getItem(`func-planner-plan-${planId}`)) ?
        JSON.parse(localStorage.getItem(`func-planner-plan-${planId}`)) :
        dup(diagram.initialModel);
    diagram.model = new go.GraphLinksModel(model.functions, model.calls);
    diagram.addModelChangedListener((e) => {
        if (e.change === go.ChangeType.Transaction) {
            console.log("Transaction", e.propertyName, e.oldValue);
        }
        if (e.isTransactionFinished) {
            console.log("Saving model");
            localStorage.setItem(`func-planner-plan-${planId}`, JSON.stringify(getModel(diagram)));
        }
    });

    // Add all of the extra windows
    if (title) {
        diagram.add(new go.Part({ layerName: "ViewportBackground", alignment: go.Spot.Top })
            .add(new go.TextBlock(title, {margin: 20}).theme('font', 'title').theme('stroke', 'text')));
    }
    makeThemeToggle(diagram);
    makeButtons(diagram);
    makeInfoBox(diagram, minFunctions, minTestable);
    setupFunctionInspector(diagram);
    setupDragAndDrop(diagram);

    // Deal with model and link problems
    updateAllProblems(diagram);
    function updateNodeLinkProblems(node) {
        diagram.model.setDataProperty(node.data, 'linkProblems', funcLinkProblems(node));
    }
    function updateLinkProblems(e) {
        const link = e.subject;
        funcIOProblemsUpdateParents(link.fromNode);
        updateNodeLinkProblems(link.fromNode);
        updateNodeLinkProblems(link.toNode);
        diagram.model.setDataProperty(link.data, 'linkProblems', linkProblems(link));
        if (e.parameter && e.parameter.part) {
            funcIOProblemsUpdateParents(e.parameter.part);
            updateNodeLinkProblems(e.parameter.part);
        }
        modelLinkProblems(diagram);
    }
    diagram.addDiagramListener('LinkDrawn', updateLinkProblems);
    diagram.addDiagramListener('LinkRelinked', updateLinkProblems);
    diagram.addDiagramListener('SelectionDeleted', (e) => {
        const parts = e.subject;
        for (const part of parts) {
            if (part instanceof go.Node) {
                modelProblems(diagram);
            } else if (part instanceof go.Link) {
                // removing a link
                if (part.fromNode && !parts.has(part.fromNode)) {
                    funcIOProblemsUpdateParents(part.fromNode);
                    updateNodeLinkProblems(part.fromNode);
                }
                if (part.toNode && part.toNode !== part.fromNode && !parts.has(part.toNode)) {
                    updateNodeLinkProblems(part.toNode);
                }
                modelLinkProblems(diagram);
            }
        }
    });
    diagram.addModelChangedListener((e) => {
        if (e.change === go.ChangedEvent.Insert && e.propertyName === 'nodeDataArray') {
            // node added
            const nodeData = e.newValue;
            diagram.model.setDataProperty(nodeData, 'problems', funcProblems(nodeData, diagram));
            diagram.model.setDataProperty(nodeData, 'linkProblems', funcLinkProblems(diagram.findNodeForData(nodeData)));
            modelProblems(diagram);
        } else if (e.change === go.ChangedEvent.Remove && e.propertyName === 'nodeDataArray') {
            // node removed
            modelProblems(diagram);
        }
    });

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

const INSTRUCTIONS = `
<div class="func-planner-instructions">
<h2>Function Planner</h2>
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
<p>The buttons on the left allow you to add functions, generate a Python template, save the diagram, and other actions.</p>
<p>To add a new function call, drag from the edge of one function to another. They can be reconnected as needed.</p>
<p>To remove functions or calls, select them and press the delete key.</p>
</div>
`

function setupFunctionInspector(diagram) {
    const diagramDiv = diagram.div;
    const rootElem = diagramDiv.parentNode;

    const resizer = document.createElement('div');
    resizer.className = 'inspector-resizer';
    rootElem.appendChild(resizer);

    const inspectorDiv = document.createElement('div');
    inspectorDiv.className = 'inspector';
    inspectorDiv.innerHTML = INSTRUCTIONS;
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

    function inspectObject(node) {
        inspectorDiv.innerHTML = '';
        if (!node) { inspectorDiv.innerHTML = INSTRUCTIONS; return; }
        const problemsDiv = document.createElement('div');
        problemsDiv.className = 'problems';
        const data = node.data;

        function updateProblems(fix = false, key = null) {
            const problems = funcProblems(data, diagram, fix);
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
            diagram.model.setDataProperty(data, 'problems', problems);
            if (key === 'name') { // recheck the link problems since "main" is special   
                diagram.model.setDataProperty(data, 'linkProblems', funcLinkProblems(node));
                for (const link of node.findLinksConnected()) {
                    diagram.model.setDataProperty(link.data, 'linkProblems', linkProblems(link));
                }
            }
            if (key === 'name' || key === 'testable') {  // recheck the model problems since it counts the number of testable functions and if there is a "main"
                modelProblems(diagram);
            }
            if (key === 'io') {  // recheck the parent's io problems due to indirect/none
                funcIOProblemsUpdateParents(diagram.findNodeForData(data));
            }
            const allProbs = problems.concat(data.linkProblems || []);
            if (allProbs.length > 0) {
                problemsDiv.innerHTML = '<h3>Problems</h3><ul class="problems">' + 
                    allProbs.map(p => `<li class="${p[0]}">${p[2]}</li>`).join('') + '</ul>';
            } else {
                problemsDiv.innerHTML = '';
            }
        }

        function setValue(key, value, fix=false) {
            diagram.model.setDataProperty(data, key, value);
            updateProblems(fix, key);
        }

        // set a value (for one-shot values)
        function set(key, value) {
            diagram.commit((d) => { if (data[key] !== value) { setValue(key, value, true); } }, `${key} changed`);
        }

        // update and commit a transaction (for multi-step changes)
        let currentTransaction = null;
        function update(key, value, fix=false) {
            if (data[key] !== value || fix) {
                // make sure there is a transaction in progress
                if (currentTransaction !== key) {
                    if (currentTransaction) { diagram.commitTransaction(`${currentTransaction} changed`); }
                    diagram.startTransaction(`${key} changed`);
                    currentTransaction = key;
                }

                // update the value
                setValue(key, value, fix);
            }
        }
        function end(key, value) {
            update(key, value, true);
            // commit the transaction
            if (currentTransaction === key) {
                diagram.commitTransaction(`${key} changed`);
                currentTransaction = null;
            }
        }

        inspectorDiv.classList.toggle('is-main', data.name === 'main');
        inspectorDiv.appendChild(makeFuncName(diagram, data, update, end, inspectorDiv));
        inspectorDiv.appendChild(makeFuncDesc(diagram, data, update, end));
        inspectorDiv.appendChild(makeParams(diagram, data, update, end));
        inspectorDiv.appendChild(makeReturns(diagram, data, update, end));
        inspectorDiv.appendChild(makeIOSelect(diagram, data, set));
        inspectorDiv.appendChild(makeTestableCheckbox(diagram, data, set));
        updateProblems();
        inspectorDiv.appendChild(problemsDiv);
    }

    diagram.addDiagramListener('ChangedSelection', (e) => {
        let subject = e.subject.first();
        if (subject instanceof go.Link) {
            return; // keep same
            //subject = subject.fromNode; // show the fromNode of the link
            //inspectorDiv.innerHTML = INSTRUCTIONS; // show help
        }
        inspectObject(subject);
    });
}

function makeFuncName(diagram, data, update, end, inspectorDiv) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'func-name';
    input.placeholder = 'Function Name';
    input.required = true;
    input.pattern = '[a-zA-Z_][a-zA-Z0-9_]*';
    input.value = data.name || '';
    input.readOnly = isReadOnly(data, 'name');

    input.addEventListener('input', (e) => {
        inspectorDiv.classList.toggle('is-main', e.target.value.trim() === 'main');
        update('name', createValidIdentifier(e.target.value));
    });
    input.addEventListener('blur', (e) => {
        inspectorDiv.classList.toggle('is-main', e.target.value.trim() === 'main');
        end('name', createValidIdentifier(e.target.value));
    });

    const h2 = document.createElement('h2');
    h2.appendChild(input);
    return h2;
}
function makeFuncDesc(diagram, data, update, end) {
    const textarea = document.createElement('textarea');
    textarea.className = 'func-desc';
    textarea.placeholder = 'Description';
    textarea.required = true;
    textarea.value = data.desc || '';
    textarea.readOnly = isReadOnly(data, 'desc');
    textarea.addEventListener('input', (e) => { update('desc', e.target.value.trim()); });
    textarea.addEventListener('blur', (e) => { end('desc', e.target.value.trim()); });
    return textarea;
}
function createValidIdentifier(name) {
    if (name.includes('(')) { name = name.split('(')[0]; }
    return name.trim().replace(/[^a-zA-Z0-9_]/g, '_');
}

function makeIOSelect(diagram, data, set) {
    const select = document.createElement('select');
    select.className = 'func-io';
    select.disabled = isReadOnly(data, 'io');

    const options = [
        { value: 'none', text: 'None' },
        { value: 'indirect', text: 'Indirect I/O' },
        { value: 'output', text: 'Output Only' },
        { value: 'input', text: 'Basic Input' },
        { value: 'validation', text: 'Validated Input' }
    ];

    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.text;
        if (data.io === opt.value) { option.selected = true; }
        select.appendChild(option);
    });

    select.addEventListener('change', (e) => { set('io', e.target.value); });

    return wrapWithLabel(select, 'User I/O: ');
}
function makeTestableCheckbox(diagram, data, set) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'func-testable';
    checkbox.checked = data.testable || false;
    checkbox.disabled = isReadOnly(data, 'testable');
    checkbox.addEventListener('change', (e) => { set('testable', e.target.checked); });
    return wrapWithLabel(checkbox, 'Testable: ');
}
function wrapWithLabel(elem, text) {
    const label = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = text;
    label.appendChild(span);
    label.appendChild(elem);
    return label;
}

function makeParams(diagram, data, update, end) {
    return createVarsBox(diagram, "Parameter", "params", data, update, end, saveParams, makeParam);
}
function makeParam(diagram, data, save, index=-1) {
    const pData = (index >= 0) ? data.params[index] : { name: '', type: '', desc: '' };
    const ro = isReadOnly(data, 'params') || isReadOnly(data, `params.${pData.name}`) || isReadOnly(data, `params.${index}`);
    return createVarBox(diagram, pData, ro, () => makeParam(diagram, data, save), save);
}
function saveParams(div, update, end, major=false) {
    const params = [];
    for (const param of div.getElementsByClassName("func-var")) {
        const name = param.getElementsByClassName("func-var-name")[0].value;
        const type = param.getElementsByClassName("func-var-type")[0].value;
        const desc = param.getElementsByClassName("func-var-desc")[0].value;
        params.push({ name, type, desc });
    }
    if (major) { end('params', params); }
    else { update('params', params); }

}

function makeReturns(diagram, data, update, end) {
    return createVarsBox(diagram, "Return", "returns", data, update, end, saveReturns, makeReturn);
}
function makeReturn(diagram, data, save, index=-1) {
    const rData = (index >= 0) ? data.returns[index] : { type: '', desc: '' };
    const ro = isReadOnly(data, 'returns') || isReadOnly(data, `returns.${index}`);
    return createVarBox(diagram, rData, ro, () => makeReturn(diagram, data, save), save);
}
function saveReturns(div, update, end, major=false) {
    const returns = [];
    for (const ret of div.getElementsByClassName("func-var")) {
        const type = ret.getElementsByClassName("func-var-type")[0].value;
        const desc = ret.getElementsByClassName("func-var-desc")[0].value;
        returns.push({ type, desc });
    }
    if (major) { end('returns', returns); }
    else { update('returns', returns); }
}

function createSectionHeader(title) {
    let h3 = document.createElement("h3");
    h3.textContent = title;
    return h3;
}
function createVarsBox(diagram, name, field, data, update, end, saveVar, makeVar) {
    const div = document.createElement("div");
    div.className = "func-params func-vars";
    const list = document.createElement("div");

    function save(major=false) { saveVar(list, update, end, major); }
    function make(index=-1) { list.appendChild(makeVar(diagram, data, save, index)); }

    div.appendChild(createSectionHeader(name+"(s)"));
    addAddButton(div, () => { make(); save(true); }, isReadOnly(data, field));
    div.appendChild(list);
    for (const index of (data[field] || []).keys()) { make(index); }
    // save();
    if (!isReadOnly(data, field)) {
        Sortable.create(list, {
            group: field,
            handle: '.func-var-drag-handle',
            filter: '.func-var-drag-disabled',
            direction: 'vertical',
            onUpdate: () => save(true),
        });
    }
    return div;
}
function createVarBox(diagram, data, ro, make, save) {
    const box = document.createElement("div");
    box.className = "func-var";
    addDragHandle(box, () => { save(true); }, ro);
    addAddButton(box, () => { box.before(make()); save(true); }, ro);
    addRemoveButton(box, () => save(true), ro);
    if (data.hasOwnProperty('name')) {
        addNameElement(box, data.name || '', (major) => save(major), ro);
        box.appendChild(document.createElement("span")).appendChild(document.createTextNode(" : "));
    }
    addTypeElement(diagram, box, data.type || '', () => save(true), ro);
    addDescElement(box, data.desc || '', (major) => save(major), ro);
    return box;
}
function addNameElement(elem, value, callback, locked=false) {
    const name = document.createElement("input");
    name.addEventListener("input", () => callback(false));
    name.addEventListener("blur", () => callback(true));
    name.type = "text";
    name.className = "func-var-name";
    name.placeholder = "name";
    name.required = true;
    name.pattern = "[a-zA-Z_][a-zA-Z0-9_]*";
    name.readOnly = locked;
    name.value = value || '';
    elem.appendChild(name);
}
function isContainerType(type) {
    return type.startsWith("list") || type.startsWith("tuple") || type.startsWith("dict") || type.startsWith("set");
}
function removeCustomTypeOption(select) {
    const options = select.options;
    if (options[options.length - 1].customType) { select.removeChild(options[options.length - 1]); }
}
function addCustomTypeOption(select, type) {
    removeCustomTypeOption(select);
    const opt = makeOption(type, type);
    opt.customType = true;
    select.options.add(opt);
    select.value = type;
}
function addTypeElement(diagram, elem, value, callback, locked=false) {
    const holder = document.createElement("span");
    holder.className = "func-var-type-holder";
    elem.appendChild(holder);

    const type = document.createElement("select");
    type.addEventListener("change", async () => {
        if (isContainerType(type.value)) {
            const result = await showTypeBuilder(diagram, type.value);
            if (result === null) { type.value = type.lastSelected; return; }
            addCustomTypeOption(type, result);
        } else { removeCustomTypeOption(type); }
        callback();
    });
    for (const t of diagram.allowedTypes) { type.appendChild(makeOption(t, t)); }
    type.className = "func-var-type";
    if (!value) { type.value = diagram.allowedTypes[0]; }
    else if (diagram.allowedTypes.includes(value)) { type.value = value; }
    else { addCustomTypeOption(type, value); }
    type.lastSelected = type.selectedOptions[0].value;
    type.disabled = locked;
    holder.appendChild(type);

    if (!locked) {
        // edit button
        const button = document.createElement("button");
        button.type = "button";
        button.className = "func-var-type-edit";
        button.title = "Edit Type...";
        button.innerHTML = "&#9998;";
        button.addEventListener("click", async () => {
            const result = await showTypeBuilder(diagram, type.value);
            if (result !== null) { addCustomTypeOption(type, result); callback(); }
        });
        holder.appendChild(button);
    }
}
function addDescElement(elem, value, callback, locked=false) {
    let desc = document.createElement("input");
    desc.addEventListener("input", () => callback(false));
    desc.addEventListener("blur", () => callback(true));
    desc.type = "text";
    desc.className = "func-var-desc";
    desc.placeholder = "description";
    desc.required = true;
    desc.readOnly = locked;
    desc.value = value || '';
    elem.appendChild(desc);
}
function addDragHandle(elem, callback, locked=false) {
    if (locked) {
        elem.classList.add("func-var-drag-disabled");
        return;
    }
    const handle = document.createElement("div");
    handle.className = "func-var-drag-handle";
    elem.appendChild(handle);
}
function addVarButton(elem, name, callback, locked=false) {
    if (locked) { return; }
    const button = document.createElement("div");
    button.className = "func-var-button func-var-button-" + name;
    button.addEventListener("click", callback);
    fetch(`${name}.svg`)
        .then(response => response.text())
        .then(svg => { button.innerHTML = svg; })
        .catch(err => {
            console.error(`Error loading ${name}.svg:`, err);
            button.textContent = name === "remove" ? "x" : "+"; // fallback text
        });
    elem.appendChild(button);
}
function addAddButton(elem, createFunc, locked=false) {
    addVarButton(elem, "add", createFunc, locked);
}
function addRemoveButton(elem, callback, locked=false) {
    addVarButton(elem, "remove", () => { elem.parentElement.removeChild(elem); callback(); }, locked);
}

async function showTypeBuilder(diagram, initialType) {
    let result = null;
    const returnValue = await Swal.fire({
        theme: diagram.themeManager.currentTheme,
        title: "Create Type",
        html: "<div class='func-planner-type-builder'></div>",
        showCancelButton: true,
        willOpen: (popup) => {
            const content = popup.querySelector('.func-planner-type-builder');
            function onChange(value) {
                if (!value.includes('?')) { result = value; }
            }
            const editor = new TypeEditor(content, {
                onChange, allowedTypes: diagram.allowedTypes, initialType: initialType.trim()
            });
        },
    });
    return returnValue.isConfirmed ? result : null;
}

function makeButtons(diagram) {
    const widgets = document.createElement('div');
    widgets.className = 'func-planner-widgets';
    diagram.div.parentNode.appendChild(widgets);

    const holder = document.createElement('div');
    holder.className = 'button-holder';
    widgets.appendChild(holder);

    addButton(holder, 'magnifier.svg', '', 'Zoom to Fit', () => { diagram.zoomToFit(); });
    addButton(holder, 'add.svg', 'no-outline', 'Add Function', () => {
        let key = diagram.model.nodeDataArray.length + 1;
        while (diagram.model.findNodeDataForKey(key)) { key++; } // ensure unique key
        diagram.model.addNodeData({
            key: key, name: '', desc: '',
            params: [], returns: [], io: "none",
            readOnly: false, testable: false,
        });
    });
    addButton(holder, 'reset.svg', 'no-outline', 'Reset', () => { reset(diagram); });

    let undoButton = addButton(holder, 'undo.svg', 'no-outline', 'Undo', () => { if (diagram.undoManager.canUndo()) { diagram.undoManager.undo(); } });
    undoButton.disabled = !diagram.undoManager.canUndo();
    diagram.addModelChangedListener((e) => {
        if (e.isTransactionFinished) {
            undoButton.disabled = !diagram.undoManager.canUndo() || diagram.undoManager.transactionToUndo.name === 'Initial Layout';
        }
    });

    addButton(holder, 'python.svg', '', 'Create Python Template', () => { exportToPython(diagram); });
    addButton(holder, 'unit-tests.svg', '', 'Generate Python Unit Tests', () => { exportPythonTests(diagram); });
    addButton(holder, 'save.svg', 'no-outline', 'Save as JSON', () => { saveJSON(diagram); });
    addButton(holder, 'load.svg', 'no-outline', 'Load from JSON', () => { loadJSON(diagram); });
}
function addButton(holder, icon, classes, name, callback) {
    const button = document.createElement('button');
    let img;
    if (icon.toLowerCase().endsWith('.svg')) {
        img = document.createElement('div');
        fetch(icon)
            .then(response => response.text())
            .then(svg => { img.innerHTML = svg; })
            .catch(err => console.error("Error loading icon:", err));
    } else {
        img = document.createElement('img');
        img.src = icon;
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
<label class="theme-toggle" title="Toggle theme">
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
function makeInfoBox(diagram, min_funcs = 1, min_testable = 0) {
    const infoBox = document.createElement('div');
    infoBox.className = 'info-box';
    infoBox.innerHTML = '<table>' +
        `<tr class="func-planner-count"><td>Functions:</td><td>0</td><td>/</td><td>${min_funcs}</td></td></tr>` +
        `<tr class="func-planner-testable"><td>Testable:</td><td>0</td><td>/</td><td>${min_testable}</td></tr>` +
        '</table><span class="func-planner-main-check value-hidden value-error">Need a main function</span>';
    diagram.div.parentNode.getElementsByClassName('func-planner-widgets')[0].appendChild(infoBox);
    if (min_funcs <= 1) { infoBox.getElementsByClassName('func-planner-count')[0].classList.add('value-hidden'); }
    if (min_testable <= 0) { infoBox.getElementsByClassName('func-planner-testable')[0].classList.add('value-hidden'); }
}

function setupDragAndDrop(diagram) {
    const div = diagram.div;
    div.addEventListener("drop", (e) => {
        e.preventDefault();
        div.classList.remove('func-planner-drag-over');

        if (e.dataTransfer.items) {
            // TODO: dragging from VS Code comes over as a set of strings?
            console.log([...e.dataTransfer.items].filter(item => item.kind === "file").length,
                [...e.dataTransfer.items].filter(item => item.kind === "string").length);
            console.log(e.dataTransfer.files.length);

            const items = e.dataTransfer.items;
            if (items.length >= 3 && items[0].kind === "string" && items[1].kind === "string" && items[2].kind === "string") {
                items[1].getAsString((str) => { if (str.startsWith("file://")) {
                    [...items].forEach((item, i) => {
                        if (item.kind === "file") { console.log(i, "dnd - file:", item.getAsFile().name); }
                        else if (item.kind === "string") { item.getAsString((str) => { console.log(i, "dnd - str:", str); }); }
                    });
                } });
            }

            const item = e.dataTransfer.items[0];
            if (item.kind === "file") { loadJSONFile(diagram, item.getAsFile()); }
            else if (item.kind === "string") {
                item.getAsString((str) => {
                    if (str.startsWith("{")) { loadJSONString(diagram, str); }
                });
            }
        } else if (e.dataTransfer.files) {
            loadJSONFile(diagram, e.dataTransfer.files[0]);
        }
    });
    div.addEventListener("dragenter", (e) => { e.preventDefault(); div.classList.add('func-planner-drag-over'); });
    div.addEventListener("dragover", (e) => { e.preventDefault(); div.classList.add('func-planner-drag-over'); });
    div.addEventListener("dragleave", (e) => { div.classList.remove('func-planner-drag-over'); });
}

function isReadOnly(data, type) {
    // The data.readOnly can be a boolean (overall readOnly) or an array of strings of read only parts
    // The part/type can be:
    //     one of the fields: 'name', 'params', 'returns', 'desc', 'io', 'testable'
    //     one of the special values: 'calls' (both in or out), 'callsInto', 'callsOutOf'
    return data.readOnly === true || (Array.isArray(data.readOnly) && data.readOnly.includes(type));
}
function isCallsIntoRO(ro) {
    return ro === true || (Array.isArray(ro) && (ro.includes('callsInto') || ro.includes('calls')));
}
function isCallsOutOfRO(ro) {
    return ro === true || (Array.isArray(ro) && (ro.includes('callsOutOf') || ro.includes('calls')));
}

function updateAllProblems(diagram) {
    const model = diagram.model;
    for (const node of diagram.nodes) {
        const data = node.data;
        model.setDataProperty(data, 'problems', funcProblems(data, diagram));
        model.setDataProperty(data, 'linkProblems', funcLinkProblems(node));
        for (const link of node.findLinksConnected()) {
            model.setDataProperty(link.data, 'linkProblems', linkProblems(link));
        }
        modelProblems(diagram);
        modelLinkProblems(diagram);
    }
}

function modelProblems(diagram) {
    const infoBox = diagram.div.parentNode.getElementsByClassName('info-box')[0];
    const countRow = infoBox.getElementsByClassName('func-planner-count')[0];
    const min_funcs = parseInt(countRow.cells[3].textContent) || 1;
    const testableRow = infoBox.getElementsByClassName('func-planner-testable')[0];
    const min_testable = parseInt(testableRow.cells[3].textContent) || 0;

    const model = diagram.model;
    const nodes = model.nodeDataArray;
    // const problems = [];

    // Check for main function
    infoBox.getElementsByClassName('func-planner-main-check')[0].classList.toggle('value-hidden', nodes.some(n => n.name === 'main'));
    //if (!nodes.some(n => n.name === 'main')) { problems.push(["error", "main", "There must be a main() function."]); }

    // Check that there are a minimum number of functions in total
    countRow.cells[1].textContent = nodes.length;
    countRow.classList.toggle('value-error', nodes.length < min_funcs);
    //if (nodes.length < min_funcs) { problems.push(["error", "functions", `There must be at least ${min_funcs} functions.`]); }

    // Check that there are a minimum number of testable functions
    const nTestable = nodes.filter(n => n.testable).length;
    testableRow.cells[1].textContent = nTestable;
    testableRow.classList.toggle('value-error', nTestable < min_testable);
    //if (nTestable < min_testable) { problems.push(["error", "testable", `There must be at least ${min_testable} testable functions.`]); }
}
function modelLinkProblems(diagram, startingKey = null) {
    const model = diagram.model;
    const cycles = findCycles(diagram, startingKey).filter(cycle => cycle.length > 1); // only cycles with more than one node (self-recursive functions are already handled)
    const map = cyclesToMap(cycles);
    for (const link of model.linkDataArray) {
        const lp = link.linkProblems || [];
        const currentlyHasCycle = lp.some(p => p[2].includes('cycle'));
        if (map.has(link.from) && map.get(link.from).includes(link.to)) {
            if (!currentlyHasCycle) { model.setDataProperty(link, 'linkProblems', lp.concat([["warning", "link", 'Part of a recursive cycle. Recursive functions are tricky, be careful if this is what you intended.']])); }
        } else if (currentlyHasCycle) { model.setDataProperty(link, 'linkProblems', lp.filter(p => !p[2].includes('cycle'))); }
    }
    for (const node of model.nodeDataArray) {
        const lp = node.linkProblems || [];
        const currentlyHasCycle = lp.some(p => p[2].includes('cycle'));
        if (map.has(node.key)) {
            if (!currentlyHasCycle) { model.setDataProperty(node, 'linkProblems', lp.concat([["warning", "callsInto", 'Part of a recursive cycle. Recursive functions are tricky, be careful if this is what you intended.']])); }
        } else if (currentlyHasCycle) { model.setDataProperty(node, 'linkProblems', lp.filter(p => !p[2].includes('cycle'))); }
    }
}
function findCycles(diagram, startingKey = null) {
    const model = diagram.model;
    const nodes = model.nodeDataArray;
    const links = model.linkDataArray;
    let cycles = [];

    // Check that there are no cycles in the function calls
    // This can produce a few duplicates, but things would have to be very convoluted for that to happen
    const callGraph = linksToMap(links);
    const keys = new Set(nodes.map(n => n.key));
    const stack = [];
    const dfs = function(key) {
        if (!keys.has(key)) { return; }
        keys.delete(key);
        stack.push(key);
        for (const to of callGraph[key] || []) {
            if (stack.includes(to)) { cycles.push(stack.slice(stack.lastIndexOf(to))); } else { dfs(to); }
        }
        stack.pop();
    }
    if (startingKey) {
        // only cycles starting from a specific function
        dfs(startingKey);
        // it can find cycles starting from other functions so we filter them out
        cycles = cycles.filter(cycle => cycle.includes(startingKey));
    } else { while (keys.size > 0) { dfs(keys.values().next().value); } } // all cycles

    return cycles;
}
function linksToMap(links) {
    const map = {};
    for (const link of links) {
        if (!map[link.from]) { map[link.from] = []; }
        map[link.from].push(link.to);
    }
    return map;
}
function cyclesToMap(cycles) {
    const links = new Map();
    for (const cycle of cycles) {
        for (let i = 0; i < cycle.length; i++) {
            const from = cycle[i];
            const to = cycle[(i + 1) % cycle.length];
            if (!links.has(from)) { links.set(from, []); }
            links.get(from).push(to);
        }
    }
    return links;
}

function linkProblems(link) {
    const data = link.data;
    const problems = [];
    if (link.toNode.data.name === 'main') { problems.push(["error", "link", "Main function should not be called by other functions."]); }
    else if (link.toNode === link.fromNode) { problems.push(["warning", "link", "Recursive functions are tricky, be careful if this is what you intended."]); }
    return problems;
}
function funcLinkProblems(node) {
    const data = node.data;
    const problems = [];

    const isMain = data.name === 'main';
    const nodesInto = Array.from(node.findNodesInto());
    const nodesOutOf = Array.from(node.findNodesOutOf());
    if (isMain) {
        if (nodesInto.length !== 0) { problems.push(["error", "callsInto", "Main function should not be called by other functions."]); }
        if (nodesOutOf.length === 0) { problems.push(["warning", "callsOutOf", "Main function should call at least one other function."]); }
    } else {
        if (nodesInto.length === 0) { problems.push(["error", "callsInto", "Non-main functions must be called by at least one other function."]); }
        else if (nodesInto.includes(node)) { problems.push(["warning", "callsInto", "Recursive functions are tricky, be careful if this is what you intended."]); }
    }

    return problems;
}

function funcIOProblems(node) {
    const data = node.data;
    const problems = [];
    const io = data.io || 'none';
    if (data.name === 'main') {
        if (!['none', 'indirect'].includes(io)) { problems.push(["warning", "io", "Main function should not have any direct user input or output."]); }
    }
    if (data.testable && io !== 'none') { problems.push(["error", "testable,io", "We cannot test functions that have direct or indirect user input or output."]); }
    if (io === 'indirect' || io === 'none') {
        const hasChildIO = treeHasIO(node);
        if (io === 'indirect') {
            if (!hasChildIO) { problems.push(["error", "io", "Function is marked as having indirect user I/O but no function it calls has user input/output."]); }
        } else if (hasChildIO) { problems.push(["error", "io", "Function is marked as having no user input/output but calls another function with user input/output; it should be marked as 'indirect'."]); }
    }
    return problems;
}
function treeHasIO(node, checked = new Set()) {
    if (checked.has(node.key)) return false; // avoid infinite recursion
    checked.add(node.key);
    if (['validation', 'input', 'output'].includes(node.data.io)) return true;
    return Array.from(node.findNodesOutOf()).some(child => treeHasIO(child, checked));
}
function funcIOProblemsUpdate(node) {
    const curProblems = node.data.problems;
    const ioProblems = funcIOProblems(node);
    const newProblems = curProblems.filter(p => !p[1].split(',').includes('io')).concat(ioProblems);
    if (!deepEquals(curProblems, newProblems)) { node.diagram.model.setDataProperty(node.data, 'problems', newProblems); }
}
function funcIOProblemsUpdateParents(node, visited = new Set()) {
    if (visited.has(node.key)) return; // avoid infinite recursion
    visited.add(node.key);
    funcIOProblemsUpdate(node);
    for (const parent of node.findNodesInto()) {
        funcIOProblemsUpdateParents(parent, visited);
    }
}

const PYTHON_KEYWORDS = new Set([
    'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
    'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
    'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass',
    'raise', 'return', 'try', 'while', 'with', 'yield'
]);
const PYTHON_BUILTINS = new Set([
    'abs', 'all', 'any', 'ascii', 'bin', 'bool', 'bytearray', 'bytes',
    'callable', 'chr', 'classmethod', 'compile', 'complex', 'delattr', 'dict',
    'dir', 'divmod', 'enumerate', 'eval', 'exec', 'filter', 'float', 'format',
    'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'help', 'hex', 'id',
    'input', 'int', 'isinstance', 'issubclass', 'iter', 'len', 'list', 'locals',
    'map', 'max', 'memoryview', 'min', 'next', 'object', 'oct', 'open', 'ord',
    'pow', 'print', 'property', 'range', 'repr', 'reversed', 'round', 'set',
    'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super',
    'tuple', 'type', 'vars', 'zip'
]);
function checkName(name, type, field) {
    if (!name) { return ["error", field, `${type} name is required.`]; }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) { return ["error", field, `${type} name must start with a letter or underscore and contain only letters, numbers, and underscores.`]; }
    if (PYTHON_KEYWORDS.has(name)) { return ["error", field, `${type} name cannot be a Python keyword.`]; }
    if (PYTHON_BUILTINS.has(name)) { return ["error", field, `${type} name cannot be a Python built-in function or type.`]; }
    if (name.startsWith('_') || name.endsWith('_')) { return ["warning", field, `${type} name should not start or end with an underscore.`]; }
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) { return ["warning", field, `${type} names should be in lowercase with underscores separating words.`]; }
    return null;
}
function funcProblems(data, diagram, fix=false) {
    const problems = [];

    const nameProblem = checkName(data.name, "Function", "name");
    if (nameProblem) { problems.push(nameProblem); }
    if (data.name && diagram && diagram.findNodesByExample({ name: data.name }).count > 1) { problems.push(["error", "name", "Function name must be unique."]); }

    const isMain = data.name === 'main';
    const desc = (data.desc || '').trim();
    const params = data.params || [];
    const returns = data.returns || [];
    const io = data.io || 'none';
    const testable = data.testable || false;
    if (isMain) {
        if (fix) {
            data.desc = '';
            data.params = [];
            data.returns = [];
        } else {
            if (desc.length > 0) { problems.push(["warning", "desc", "Main function does not need a description."]); }
            if (params.length > 0) { problems.push(["error", "params", "Main function should not have parameters."]); }
            if (returns.length > 0) { problems.push(["error", "returns", "Main function should not return values."]); }
        }
    } else {
        if (desc.length === 0) { problems.push(["warning", "desc", "Function description is required."]); }
        else if (desc.length < 20) { problems.push(["warning", "desc", "Function description is too short - be more descriptive!"]); }
        if (params.length === 0 && returns.length === 0) { problems.push(["error", "params,returns", "Non-main functions should have at least one parameter or return value."]); }
        const names = [];
        for (let i = 0; i < params.length; i++) {
            const param = params[i];
            const problem = checkName(param.name, "Parameter", `params[${i}].name`);
            if (problem) { problems.push(problem); }
            if (names.includes(param.name)) {
                const index = names.indexOf(param.name);
                problems.push(["error", `params[${index}].name`, "Parameter name must be unique within a function."]);
                problems.push(["error", `params[${i}].name`, "Parameter name must be unique within a function."]);
            }
            names.push(param.name);
            if (!param.type) { problems.push(["error", `params[${i}].type`, "Parameter type is required."]); }
            if (!param.desc) { problems.push(["error", `params[${i}].desc`, "Parameter description is required."]); }
            else if (param.desc.length < 10) { problems.push(["warning", `params[${i}].desc`, "Parameter description is too short - be more descriptive!"]); }
        }
        for (let i = 0; i < returns.length; i++) {
            const ret = returns[i];
            if (!ret.type) { problems.push(["error", `returns[${i}].type`, "Return value type is required."]); }
            if (!ret.desc) { problems.push(["error", `returns[${i}].desc`, "Return value description is required."]); }
            else if (ret.desc.length < 10) { problems.push(["warning", `returns[${i}].desc`, "Return value description is too short - be more descriptive!"]); }
        }
    }

    if (testable && params.length === 0) { problems.push(["warning", "testable,params", "Testable functions should have at least one parameter."]); }
    if (testable && returns.length === 0) { problems.push(["warning", "testable,returns", "Testable functions should have at least one return value."]); }
    if (diagram) { problems.push(...funcIOProblems(diagram.findNodeForData(data))); }
    return problems;
}


function deepEquals(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) && Array.isArray(b) && a.length == b.length && a.every((x, i) => deepEquals(x, b[i]))) return true;
    if (Object.keys(a).length !== Object.keys(b).length) return false;
    return Object.keys(a).every(key => (key in b) && deepEquals(a[key], b[key]));
}
function dup(obj) { return JSON.parse(JSON.stringify(obj)); }
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function makeOption(value, text) {
    let option = document.createElement("option");
    option.value = value;
    option.text = text;
    return option;
}
function htmlToNode(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.firstElementChild;
}
function copyToClipboard(text) {
    let textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
}
function downloadDataAsFile(filename, text, mime='text/plain') {
  const link = document.createElement('a');
  link.href = 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(text);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function wrapText(text, width=80, indent=4) {
    width = width - indent;
    indent = " ".repeat(indent);
    text = text.replace(new RegExp(`(?![^\\n]{1,${width}}$)([^\\n]{1,${width}})\\s`, 'g'), indent + '$1\n');
    let lastBreak = text.lastIndexOf("\n");
    if (lastBreak === -1) { return `${indent}${text}`; }
    text = text.slice(0, lastBreak) + "\n" + indent + text.slice(lastBreak + 1);
    return text;
}
function indentText(text, indent=4) {
    indent = " ".repeat(indent);
    return text.split("\n").map(line => indent + line).join("\n");
}

function splitOnMatchingParen(str) {
    let stack = [];
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '(') {
            stack.push(i);
        } else if (char === ')') {
            const matchIndex = stack.pop();
            if (matchIndex === 0) {
                return [str.slice(1, i).trim(), str.slice(i + 1).trim()];
            }
        }
    }
    return [null, str];
}
function splitOnCommasIgnoringParens(str) {
    const results = [];
    let current = '';
    let parenDepth = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '(') {
            parenDepth++;
            current += char;
        } else if (char === ')') {
            parenDepth--;
            current += char;
        } else if (char === ',' && parenDepth === 0) {
            // Split here - comma is not inside parentheses
            results.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    // Add the last part
    if (current) { results.push(current.trim()); }
    return results;
}
function removeOuterParens(text) {
    text = text.trim();
    if (text.startsWith("(") && text.endsWith(")")) {
        let [part, rest] = splitOnMatchingParen(text);
        if (rest === "") { return part; }
    }
    return text;
}
function normalizeString(text) {
    return removeOuterParens(text.trim().replace(/\s+/g, ' '));
}
function mapList(text, fn) {
    text = normalizeString(text);
    text = text.replace(/, ?and\b/, ',').replace(/ and\b/, ', ');  // normalize "and"s to commas
    console.log("mapList input:", text);
    return splitOnCommasIgnoringParens(text).map(x => fn(x.trim(), true)).join(", ");
}

function processDictType(type, fn) {
    type = type.slice(10);
    let [key, value] = type.split(" associated with ");  // TODO: nested
    if (key.startsWith("keys of ")) { key = key.slice(8); }
    if (value.startsWith("values of ")) { value = value.slice(10); }
    return [fn(key, plural=true), fn(value, plural=true)];
}
function processPlural(type) {
    // first word can be ints, floats, strs, bools, tuples, dicts, sets
    let parts = type.split(" ");
    if (parts[0].endsWith("s")) { parts[0] = parts[0].slice(0, -1); } // remove trailing 's' for plural types
    return parts.join(" ");
}

const DEFAULT_VALUES = {
    "int": "0",
    "str": '""',
    "float": "0.0",
    "bool": "False",
    "list": "[]",
    "tuple": "()",
    "dict": "{}",
    "set": "set()",
}
function defaultReturnValue(type, plural=false) {
    type = normalizeString(type);
    if (plural) { type = processPlural(type); }
    if (DEFAULT_VALUES[type]) { return DEFAULT_VALUES[type]; }
    if (type.startsWith("list of ")) { return `[${defaultReturnValue(type.slice(8), true)}]`; }
    if (type.startsWith("list with ")) { return `[${mapList(type.slice(10), defaultReturnValue)}]`; }
    if (type.startsWith("tuple of ")) { return `(${defaultReturnValue(type.slice(9), true)},)`; }
    if (type.startsWith("tuple with ")) { return `(${mapList(type.slice(11), defaultReturnValue)})`; }
    if (type.startsWith("dict of ")) { return `{"": ${defaultReturnValue(type.slice(8), true)}}`; }
    if (type.startsWith("dict with ")) { return `{${processDictType(type, defaultReturnValue).join(": ")}}`; }
    if (type.startsWith("set of ")) { return `{${defaultReturnValue(type.slice(7), true)}}`; }
    return "None";
}
function typeToPython(type, plural=false) {
    type = normalizeString(type);
    if (plural) { type = processPlural(type); }
    if (type.startsWith("list of ")) { return `list[${typeToPython(type.slice(8), true)}]`; }  // homogeneous list
    if (type.startsWith("list with ")) { return `list[${mapList(type.slice(10), typeToPython)}]`; }  // heterogeneous list (technically not supported in Python)
    if (type.startsWith("tuple of ")) { return `tuple[${typeToPython(type.slice(9), true)}, ...]`; }  // homogeneous tuple
    if (type.startsWith("tuple with ")) { return `tuple[${mapList(type.slice(11), typeToPython)}]`; }  // heterogeneous tuple
    if (type.startsWith("dict of ")) { return `dict[str, ${typeToPython(type.slice(8), true)}]`; }  // dict with keys as strings
    if (type.startsWith("dict with ")) { return `dict[${processDictType(type, typeToPython).join(", ")}]`; }  // dict with specified key and value types
    if (type.startsWith("set of ")) { return `set[${typeToPython(type.slice(7), true)}]`; }  // homogeneous set
    return type;
}
window.typeToPython = typeToPython;  // for testing
window.defaultReturnValue = defaultReturnValue;  // for testing


const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function letter(n) { return ALPHABET.charAt(n % ALPHABET.length); }
function getParam(param, i, withTypes=true) {
    let name = (param.name || letter(i)).trim();
    if (!withTypes || !param.type) { return name; }
    return `${name}: ${typeToPython(param.type)}`;
}
function pythonDefLine(name, params, returns, withTypes=true, simple=false) {
    const paramsDef = params.map((p, i) => getParam(p, i, withTypes));
    let returnDef = "";
    if (withTypes && returns.length > 0) {
        const returnTypes = returns.map(ret => typeToPython(ret.type));
        returnDef = " -> " + ((returns.length === 1) ? returnTypes[0] : `tuple[${returnTypes.join(", ")}]`);
    }
    const def = `${name}(${paramsDef.join(", ")})${returnDef}`;
    return simple ? def : `def ${def}:`;
}
function formatListInDocstring(name, list, formatItem) {
    let output = "";
    if (list.length === 1) {
        output = `    ${name}: ${formatItem(list[0], 0)}\n`;
    } else if (list.length > 1) {
        output = `    ${name}s:\n`;
        for (let [i, item] of list.entries()) { output += `        ${formatItem(item, i)}\n`; }
    }
    return output;
}
function pythonDocstring(desc, params, returns) {
    let docstring = `    """\n${wrapText(desc)}\n\n`;
    docstring += formatListInDocstring("Parameter", params, (p, i) => `${p.name || letter(i)} (${p.type}): ${p.desc}`);
    docstring += formatListInDocstring("Return", returns, (ret, i) => `${ret.type}: ${ret.desc}`);
    docstring += `    """\n`;
    return docstring;
}
function generatePythonTemplate(diagram, withTypes=true) {
    let text = '"""\nTODO: program header\n\nBy:\n"""\n\n';
    let mainFunc = null;
    // TODO: sort?
    for (const func of diagram.model.nodeDataArray) {
        // Create the def line
        let name = func.name || `function${func.key}`;
        let params = func.params || [];
        let returns = func.returns || [];
        let funcText = pythonDefLine(name, params, returns, withTypes) + "\n";

        // Create the docstring
        let desc = func.desc || "";
        if (desc) { funcText += pythonDocstring(desc, params, returns); }

        let code = func.code || "";
        if (code) {
            // Pre-provided code if available
            funcText += indentText(code, 4);
        } else {
            // Body comments
            funcText += "    # TODO: implement this function\n";
            const node = diagram.findNodeForData(func);
            const calls = Array.from(node.findNodesOutOf()).map(c => c.data.name || `function${c.data.key}`);
            if (calls.length > 0) { funcText += `    # Calls ${calls.map(call => call + "()").join(", ")}\n`; }
            let io = func.io || "none";
            if (io === "validation") { funcText += `    # Has direct user input that requires validation\n`; }
            else if (io === "input") { funcText += `    # Has direct user input\n`; }
            else if (io === "output") { funcText += `    # Has direct user output\n`; }

            // Dummy return statement
            if (returns.length > 0) {
                funcText += `    return ${returns.map(ret => defaultReturnValue(ret.type)).join(", ")}`;
            } else {
                funcText += "    pass";
            }
        }

        if (func.name === 'main') { mainFunc = funcText; }
        else { text += funcText + "\n\n\n"; }
    }
    if (mainFunc) {
        text += mainFunc + '\n\n\nif __name__ == "__main__":\n    main()\n';
    }
    return text;
}
function exportToPython(diagram, withTypes=true) {
    const text = generatePythonTemplate(diagram, withTypes);
    copyToClipboard(text);
    Swal.fire({
        theme: diagram.themeManager.currentTheme,
        imageUrl: 'python.svg',
        imageWidth: "6em",
        title: "Python Template Copied",
        html: "Python template copied to clipboard.<br>Paste it into a Python file.<br>" +
            "<a href=\"data:text/plain;charset=utf-8," + encodeURIComponent(text) + "\" download=\"" + diagram.planId + ".py\">Click here to download it.</a>",
        showCloseButton: true,
    });
}
function generatePythonTests(diagram) {
    let text = '"""\nTODO: test header\n\nBy:\n"""\n\nimport pytest\n\nimport ' + diagram.planId + '\n\n';
    for (const func of diagram.model.nodeDataArray) {
        if (func.testable) {
            text += `def test_${func.name}():\n    # TODO: write tests\n    pass\n\n`;
        }
    }
    text += `if __name__ == '__main__':\n    pytest.main(["--no-header", "--tb=short"])\n`;
    return text;
}
function exportPythonTests(diagram) {
    const text = generatePythonTests(diagram);
    copyToClipboard(text);
    Swal.fire({
        theme: diagram.themeManager.currentTheme,
        imageUrl: 'unit-tests.svg',
        imageWidth: "6em",
        title: "Python Unit Tests Copied",
        html: "Python unit tests copied to clipboard.<br>Paste it into a Python file that ends with <code>_test.py</code>.<br>" +
            "<a href=\"data:text/plain;charset=utf-8," + encodeURIComponent(text) + "\" download=\"" + diagram.planId + "_test.py\">Click here to download it.</a>",
        showCloseButton: true,
    });

}

function confirmDialog(title, text, confirmFunc, theme='auto') {
    Swal.fire({
        title: title,
        text: text,
        icon: "warning",
        theme: theme,
        showCancelButton: true,
        showCloseButton: true,
        focusConfirm: false,
    }).then((confirm) => { if (confirm) { confirmFunc(); } });
}
function setModel(diagram, model) {
    if (!model.functions || !model.calls) { return "Invalid model format. Expected 'functions' and 'calls' keys."; }
    diagram.model = new go.GraphLinksModel(model.functions, model.calls);
    updateAllProblems(diagram);
}
function reset(diagram, confirm = true) {
    if (confirm) {
        confirmDialog("Reset to Default?", "Are you sure you want to load the default functions for this plan? This will clear the current plan.",
            () => { reset(diagram, false); }, diagram.themeManager.currentTheme);
    } else { setModel(diagram, dup(diagram.initialModel)); }
}

function removeProblems(array) {
    return array.map(item => {
        let data = { ...item };
        delete data.problems;
        delete data.linkProblems;
        return data;
    });
}
function getModel(diagram, includeProblems=false) {
    const model = diagram.model;
    const functions = includeProblems ? model.nodeDataArray : removeProblems(model.nodeDataArray);
    const calls = includeProblems ? model.linkDataArray : removeProblems(model.linkDataArray);
    return { functions, calls };
}
function saveJSON(diagram, includeProblems=false) {
    const model = getModel(diagram, includeProblems);
    const json = JSON.stringify(model, null, 2);
    copyToClipboard(json);
    Swal.fire({
        theme: diagram.themeManager.currentTheme,
        imageUrl: 'save.svg',
        imageWidth: "6em",
        title: "JSON Copied",
        html: "JSON version copied to clipboard.<br>Save to a file so it can be reloaded later.<br>" +
            "<a href=\"data:application/json;charset=utf-8," + encodeURIComponent(json) + "\" download=\"" + diagram.planId + "-plan.json\">Click here to download it.</a>",
        showCloseButton: true,
    });
}
function loadJSON(diagram) {
    Swal.fire({
        theme: diagram.themeManager.currentTheme,
        title: "Load JSON",
        html: "Paste the JSON data below.<br>This will overwrite the current plan.",
        input: "textarea",
        showCancelButton: true,
        showCloseButton: true,
        inputValidator: (value) => {
            if (!value) { return "JSON data is required."; }
            try {
                const model = JSON.parse(value);
                if (!model.functions || !model.calls) { return "Invalid JSON format. Expected 'functions' and 'calls' keys."; }
            } catch (e) { return "Invalid JSON format"; }
            return null;
        },
    }).then((result) => {
        if (!result.isConfirmed) { return; }
        loadJSONString(diagram, result.value);
    });
}
function loadJSONString(diagram, json) {
    try {
        const model = JSON.parse(json);
        if (!model.functions || !model.calls) { throw new Error("Invalid JSON format. Expected 'functions' and 'calls' keys."); }
        setModel(diagram, model);
    } catch (e) {
        console.error("Invalid JSON data:", e);
        Swal.fire({
            theme: diagram.themeManager.currentTheme,
            title: "Invalid JSON",
            text: "The JSON data is invalid.",
            icon: "error",
            showCloseButton: true,
        });
    }
}
function loadJSONFile(diagram, file) {
    const reader = new FileReader();
    reader.onload = () => { loadJSONString(diagram, reader.result); };
    reader.onerror = () => { Swal.fire({
        theme: diagram.themeManager.currentTheme,
        title: "File Error",
        text: "Error reading the file. Please try again.",
        icon: "error",
        showCloseButton: true,
    }); };
    reader.readAsText(file);
}
