import go from 'gojs';

import { AvoidsLinksRouter } from './AvoidsLinksRouter.js';

import { makeNameEditor, isBlankFunctionName } from './name-editor.js';
import { pythonDefLine } from './save-load.js';
import { updateAllProblems, updateInterNodeProblems, willFuncBecomeRecursive } from './problem-checker.js';
import { ALLOW_RECURSIVE, SHOW_COLLAPSE_BUTTON } from './settings.js';

const DEFAULTS = {
    'name': '',
    'params': [],
    'returns': [],
    'description': '',
    'code': '',
    'io': 'none',
    'testable': false,
    'readOnly': false,
}

/**
 * Setup and return a GoJS diagram inside the given root element, using the
 * provided model and options.
 * @param {HTMLElement} rootElem 
 * @param {*} model 
 * @param {object} options 
 * @returns {go.Diagram} the GoJS diagram
 */
export function setupDiagram(
    rootElem,
    model,
    options={},
) {
    const diagramDiv = document.createElement("div");
    diagramDiv.className = "diagram";
    rootElem.appendChild(diagramDiv);
    let reversingLink = false;

    go.Diagram.licenseKey = "ACADEMIC"
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
        //'undoManager.isEnabled': true, // handled by Yjs
        'toolManager.hoverDelay': 200,
        'toolManager.toolTipDuration': 1e10,
    });
    updateDiagramTheme(diagram);

    function strokeColor(problems) {
        return problems.some(p => p[0] === 'error') ? 'error-stroke' : (problems.length > 0 ? 'warning-stroke' : 'stroke');
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
            makeNameEditor(model, options)
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
    // override the default tooltip hiding behavior to not hide when hovering over the tooltip itself
    diagram.toolManager.hideToolTip = () => {
        const elements = document.querySelectorAll(':hover');
        for (const el of elements) { if (el.classList.contains('tooltip-container')) { return; } }
        go.ToolManager.prototype.hideToolTip.call(diagram.toolManager);
    }
    // hide tooltips when linking
    diagram.toolManager.linkingTool.doActivate = function() {
        go.LinkingTool.prototype.doActivate.call(diagram.toolManager.linkingTool);
        go.ToolManager.prototype.hideToolTip.call(diagram.toolManager);
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
        // TODO: layerName: 'Background',
        doubleClick: (e, link) => {
            // Reverse the link direction on double-click
            const from = link.fromNode;
            const to = link.toNode;
            if (isCallsIntoRO(from.data.readOnly) || isCallsOutOfRO(to.data.readOnly) ||
                isCallsIntoRO(to.data.readOnly) || isCallsOutOfRO(from.data.readOnly)) { return false; }
            if (model.calls.has(`${to.data.key}-${from.data.key}`)) { return false; }
            // TODO: check recursive?
            reversingLink = true;
            model.updateFuncCall(from.data.key, to.data.key, to.data.key, from.data.key);
            reversingLink = false;
            updateAllProblems(model, options);
        },
    }).add(
        new go.Shape({ strokeWidth: 2 }).themeData('stroke', 'problems', null, strokeColor),
        new go.Shape({ toArrow: 'Standard', scale: 1.4, stroke: null })
            .themeData('fill', 'problems', null, strokeColor)
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
        if (!ALLOW_RECURSIVE && willFuncBecomeRecursive(model, fromNode.data.key, toNode.data.key)) { return false; }
        return true;
    }
    diagram.toolManager.linkingTool.linkValidation = linkValidator;
    diagram.toolManager.relinkingTool.linkValidation = linkValidator;
    diagram.commandHandler.canDeleteSelection = () => (options.adminMode || !diagram.selection.any(part =>
        (part instanceof go.Link) && (isCallsOutOfRO(part.fromNode.data.readOnly) || isCallsIntoRO(part.toNode.data.readOnly)) ||
        ((part instanceof go.Node) && part.data.readOnly)
    ));

    // Group template
    diagram.groupTemplate = new go.Group("Horizontal", {
        selectable: false,
        isShadowed: true,
        shadowOffset: new go.Point(0, 2),
        layerName: 'Background',
        layout: new go.LayeredDigraphLayout({ direction: 90, layerSpacing: 50, columnSpacing: 30 }),
    }).add(
        new go.TextBlock({
            alignment: go.Spot.TopLeft,
            angle: 270,
            width: 75,
            wrap: go.Wrap.Fit,
            textAlign: "right",
            shadowVisible: false,
        }).bind("text", "key").theme('font', 'groupText').theme('stroke', 'text'),
        new go.Panel("Auto", { alignment: go.Spot.TopLeft }).add(
            new go.Shape("RoundedRectangle", { parameter1: 6 }) // surrounds the Placeholder
                .theme('stroke')
                .theme('fill', 'bg-none')
                .themeData('fill', 'key', null, (name) => {
                    const index = (model.modelData.get('authors')?.toJSON() || []).indexOf(name);
                    return index === -1 ? 'bg-none' : `group-${index % diagram.themeManager.maxGroup + 1}`;
                }),
            new go.Placeholder({ padding: 4 }), // container for member nodes
        ),
    )
    .theme('shadowColor', 'shadow');

    // Add all of the extra UI elements
    if (options.title) {
        diagram.add(new go.Part({ layerName: "ViewportBackground", alignment: go.Spot.Top })
            .add(new go.TextBlock(options.title, {margin: 20}).theme('font', 'title').theme('stroke', 'text')));
    }
    diagram.commandHandler.deleteSelection = function() {
        const funcsToRemove = [];
        const linksToRemove = [];
        diagram.selection.each(part => {
            if (part instanceof go.Node) { funcsToRemove.push(part.data.key); }
            else if (part instanceof go.Link) { linksToRemove.push(part.data); }
        });
        diagram.clearSelection();
        model.removeFuncs(funcsToRemove);
        model.removeFuncCalls(linksToRemove);
    };
    function processChangeEvent(evt) {
        if (evt.change === go.ChangeType.Insert && evt.propertyName === "linkDataArray") {
            const { from, to } = evt.newValue;
            model.addFuncCall(from, to);
        } else if (evt.change === go.ChangeType.Remove && evt.propertyName === "linkDataArray") {
            const { from, to } = evt.oldValue;
            model.removeFuncCall(from, to);
        } else if (evt.change === go.ChangeType.Property) {
            if (evt.modelChange === "linkToKey") { // && evt.propertyName === "to"
                const from = evt.object.from;
                const oldTo = evt.oldValue;
                const newTo = evt.newValue;
                model.updateFuncCall(from, oldTo, null, newTo);
            } else if (evt.modelChange === "linkFromKey") { // && evt.propertyName === "from"
                const oldFrom = evt.oldValue;
                const newFrom = evt.newValue;
                const to = evt.object.to;
                model.updateFuncCall(oldFrom, to, newFrom, null);
            }
        }
    }

    diagram.addModelChangedListener((evt) => {
        // When the UndoManager is enabled, the CommittedTransaction event has an evt.object that is the transaction
        // However, when disabled, the CommittedTransaction event has evt.object===null so we must check each event change instead
        if (reversingLink) { return; }
        if (diagram.undoManager.isEnabled) {
            if (!evt.isTransactionFinished) { return; }
            if (evt.object == null || (evt.object.name !== "Linking" && evt.object.name !== "Relinking")) { return; }
            for (const change of evt.object.changes) { processChangeEvent(change); }
        } else if (model.synced) {
            processChangeEvent(evt);
        }
    });

    // Copy changes from Y.js model to the GoJS model
    function maybeRemoveGroup(node) {
        const group = node.containingGroup;
        if (group && group.memberParts.count === 1) {
            diagram.model.removeNodeData(group.data);
        }
    }
    function setGroup(node, group) {
        if (group) {
            // ensure the owner group exists and add this node to it
            if (!diagram.findNodeForKey(group)) {
                diagram.model.addNodeData({ key: group, isGroup: true });
            }
            diagram.model.setGroupKeyForNodeData(node.data, group);
        } else {
            diagram.model.setGroupKeyForNodeData(node.data, undefined);
        }
    }
    model.addModelDataListener('authors', (_, newValue) => {
        diagram.findTopLevelGroups().each(group => group.updateTargetBindings('key'));
    });
    model.addFuncAddListener((key, data) => {
        if (!('name' in data) || isBlankFunctionName(data.name)) { data.name = 'function'; }
        diagram.model.addNodeData({ key: key, ...data });
        if (options.canClaimFuncs && data.owner) {
            setGroup(diagram.findNodeForKey(key), data.owner);
        }
        if (model.synced) {
            // TODO: if the origin of the change is another user, don't select the new node
            diagram.select(diagram.findNodeForKey(key));
        }
    });
    model.addFuncRemoveListener((key) => {
        const node = diagram.findNodeForKey(key);
        if (node) {
            if (diagram.selection.contains(node)) { diagram.clearSelection(); }
            maybeRemoveGroup(node);
            diagram.model.removeNodeData(node.data);
        }
        updateInterNodeProblems(model, options);
    });
    model.addFuncListener('', (key, property, newValue) => {
        const node = diagram.findNodeForKey(key);
        if (node) {
            newValue = newValue ?? DEFAULTS[property]; // ensure no undefined/null values
            if (property === 'name') {
                newValue = newValue?.toString()?.trim();
                // name has issues if set to empty string
                if (newValue === '') { newValue = 'function'; }
            } else if (property === 'owner' && options.canClaimFuncs) {
                newValue = newValue?.toString()?.trim();
                maybeRemoveGroup(node);
                setGroup(node, newValue);
            }
            diagram.model.setDataProperty(node.data, property, newValue);
        }
    });
    model.addFuncListener('problems', (key, _, newValue) => {
        const node = diagram.findNodeForKey(key);
        if (node) { diagram.model.setDataProperty(node.data, 'problems', newValue); }
    });
    model.addFuncListener('linkProblems', (key, _, newValue) => {
        const node = diagram.findNodeForKey(key);
        if (node) { diagram.model.setDataProperty(node.data, 'linkProblems', newValue); }
    });
    model.addFuncCallListener((action, oldFrom, oldTo, newFrom, newTo) => {
        if (action === 'add') {
            if (diagram.findLinksByExample({ from: newFrom, to: newTo }).count === 0) {
                diagram.model.addLinkData({ from: newFrom, to: newTo });
            }
        } else {
            const link = diagram.findLinksByExample({ from: oldFrom, to: oldTo }).first();
            if (link) {
                if (action === 'problems') {
                    diagram.model.setDataProperty(link.data, 'problems', [...newFrom]);
                } else if (action === 'delete') {
                    diagram.model.removeLinkData(link.data);
                } else if (action === 'update') {
                    if (newFrom !== oldFrom) { diagram.model.setDataProperty(link.data, 'from', newFrom); }
                    if (newTo !== oldTo) { diagram.model.setDataProperty(link.data, 'to', newTo); }
                }
            }
        }
    });

    return diagram;
}

export function updateDiagramTheme(diagram) {
    const style = getComputedStyle(diagram.div);
    function getColor(name, defaultValue) {
        return style.getPropertyValue(`--${name}-color`).trim() || defaultValue;
    }
    function getFont(name, defaultValue) {
        return style.getPropertyValue(`--${name}-font`).trim() || defaultValue;
    }

    // dynamically determine how many group colors are defined in CSS, and add them to the theme
    let maxGroup = 0;
    const groupColors = {};
    const defaultGroupColors = ['#f8717140', '#f9731640', '#fbbf2440', '#34d39940', '#60a5fa40', '#a78bfa'];
    while (maxGroup < defaultGroupColors.length || style.getPropertyValue(`--group-${maxGroup+1}-color`).trim()) {
        maxGroup++;
        groupColors[`group-${maxGroup}`] = style.getPropertyValue(`--group-${maxGroup}-color`).trim() || defaultGroupColors[maxGroup-1];
    }
    diagram.themeManager.maxGroup = maxGroup;

    diagram.themeManager.set(diagram.themeManager.defaultTheme, {
        // The defaults are from the light theme, but users can override them with CSS variables
        colors: {
            text: getColor('text', '#111827'),
            link: getColor('link', getColor('stroke', '#111827')),
            stroke: getColor('stroke', '#111827'),
            'error-stroke': getColor('error-stroke', '#dc2626'),
            'warning-stroke': getColor('warning-stroke', '#f59e0b'),
            shadow: getColor('shadow', '#9ca3af'),
            'selection': getColor('selection', '#0ea5e9'),
            'selection-trans': getColor('selection-trans', 'rgba(14, 165, 233, 0.5)'),
            tempLink: getColor('temp-link', '#309e70'),
            tempPort: getColor('temp-port', '#309e70'),
            // lots of other colors built-in, see https://gojs.net/latest/api/symbols/Themes.html

            // background colors for nodes based on user I/O and testability
            'bg-testable': getColor('bg-testable', '#090'),
            'bg-validation': getColor('bg-validation', '#f60'),
            'bg-input': getColor('bg-input', '#f90'),
            'bg-output': getColor('bg-output', '#09f'),
            'bg-indirect': getColor('bg-indirect', '#d1d5db'),
            'bg-none': getColor('bg-none', '#d1d5db'),
            'bg-undefined': '#ff0000', // for debugging

            // group colors for function authorship
            ...groupColors,
        },
        fonts: {
            text: getFont('diagram-text', "14px 'Monaco', 'Menlo', 'Ubuntu Mono', monospace"),
            normal: getFont('diagram-text', "14px 'Monaco', 'Menlo', 'Ubuntu Mono', monospace"),
            bold: getFont('diagram-bold', "bold 14px 'Monaco', 'Menlo', 'Ubuntu Mono', monospace"),
            title: getFont('diagram-title', '2.5rem InterVariable, sans-serif'),
            groupText: getFont('diagram-group-text', "12px Sans-Serif"),
        },
        numbers: {
            selection: 2,
        },
    });
}

function createToolTip(rootElem) {
    function genToolTip(data) {
        let text = '<code>' + pythonDefLine(data.name || 'function', data.params || [], data.returns || [], true, true) + '</code>';
        const problems = (data.problems || []).concat(data.linkProblems || []);
        if (problems.length > 0) {
            text += "<ul class='problems'>";
            for (const [type, field, message] of problems) { text += `<li class="${type}">${message}</li>`; }
            text += "</ul>";
        }
        return text;
    }
    const toolTipElem = document.createElement('div');
    toolTipElem.className = 'tooltip-container';
    toolTipElem.style.display = 'none';
    rootElem.appendChild(toolTipElem);
    const toolTipContent = document.createElement('div');
    toolTipContent.className = 'tooltip-content';
    toolTipElem.appendChild(toolTipContent);
    return new go.HTMLInfo({
        mainElement: toolTipElem,
        show: (obj, diagram, tool) => {
            const pos = diagram.transformDocToView(obj.part.findObject('SHAPE').getDocumentPoint(go.Spot.BottomLeft));
            toolTipElem.style.left = `${pos.x-10}px`;
            toolTipElem.style.top = `${pos.y}px`;
            const text = genToolTip(obj.part.data);
            toolTipContent.innerHTML = text;
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
