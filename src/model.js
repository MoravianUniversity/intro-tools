/**
 * Functions to modify the model data. We have multiple locations the data is stored:
 *   - in the GoJS diagram.model: modelData, nodeDataArray, and linkDataArray
 *   - in the Yjs shared data structures (for collaboration)
 * Using these methods ensures that all copies of the data are kept in sync.
 * Ultimately this uses only the Yjs data structures as the source of truth. The
 * listeners in diagram.js ensure that the GoJS model is updated when there are
 * changes in Yjs. problems and linkProblems are only specially handled here so
 * they are not persisted.
 * 
 * Notes:
 * I don't really like the API designed here, parts of it are okay but lots of
 * it is awkward. Some of the issues are:
 * - When do we use functions vs properties?
 * - How sometimes problems/linkProblems have their own methods, and sometimes
 *   they are part of the other properties.
 * - How problems are handled differently for modelData vs functions vs calls.
 * - May be nice to have a general way to handle non-persisted properties.
 * - Sometimes they are links, sometimes calls, sometimes functions calls.
 * - No ability to remove listeners.
 * - How global listeners are handled, and can cause numerous unnecessary calls.
 * - Make events as objects instead of a whole bunch of parameters?
 */

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import diff from 'fast-diff';

const MODEL_DATA_TEXTS = ['documentation', 'authors', 'testDocumentation', 'globalCode'];
const FUNC_DATA_TEXTS = ['name', 'desc', 'code', 'testCode'];
const FUNC_DATA_ARRAYS = ['params', 'returns'];

export class Model {
    constructor(id, initialData={}) {
        this.synced = false;
        this.id = id;
        this.initialData = initialData;
        this.model = new Y.Doc();

        // setup modelData
        this.modelData = this.model.getMap('modelData');
        this.modelData.observeDeep((events) => { this.#modelDataObserver(events); });

        // setup functions
        this.functions = this.model.getMap('functions');
        this.functions.observeDeep((events) => { this.#funcObserver(events); });

        // setup calls
        this.calls = this.model.getMap('calls');
        this.calls.observe((event) => { this.#callObserver(event); });

        // setup persistence
        this.indexeddb = new IndexeddbPersistence(this.id, this.model); 
        this.indexeddb.on('synced', () => {
            // if database is empty, load initial data
            // TODO: if there is a server, then the server should be the source of truth instead?
            if (this.functions.size === 0 && this.calls.size === 0) {
                this.importModel(this.initialData);
            }
            this.#fireListeners(this.#listeners['synced']);
            this.synced = true;
        });

        // setup undo/redo after initial data is loaded
        this.undoManager = new Y.UndoManager([this.modelData, this.functions, this.calls], {
            untrackedOrigins: new Set([this.indexeddb]) // don't track changes from persistence (this should be the default anyways)
        });
    }

    /**
     * Export the current model data as a plain JSON object.
     * @returns {object} exported model data
     */
    exportModel() {
        return {
            ...this.modelData.toJSON(),
            functions: Array.from(this.functions.entries()).map(([key, ymap]) => {
                const func = ymap.toJSON();
                func.key = key;
                return func;
            }),
            calls: Array.from(this.calls.keys()).map(callKey => callKey.split('-')).map(
                ([from, to]) => ({ from, to })
            ),
        };
    }

    /**
     * Import model data from a plain JSON object.
     * @param {object} data imported model data
     */
    importModel(data) {
        this.model.transact(() => {
            // import modelData
            this.modelData.clear();
            for (const [prop, value] of Object.entries(data || {})) {
                if (['functions', 'calls'].includes(prop)) { continue; }
                this.modelData.set(prop, value);
            }
            // import functions
            this.functions.clear();
            for (let func of (data.functions || [])) {
                const key = func.key.toString();
                func = {...func};
                delete func.key;
                this.functions.set(key, this.convertFuncData(func));
            }
            // import calls
            this.calls.clear();
            for (const {from, to} of (data.calls || [])) {
                const callKey = `${from}-${to}`;
                this.calls.set(callKey, true);
            }
        });
    }

    /**
     * Reset the model to the initial data.
     */
    resetModel() {
        this.importModel(this.initialData);
    }

    #listeners = {};
    /**
     * Add a general listener for model events. The supported events are:
     *  - 'synced': when the model has finished its initial syncing
     * @param {string} event 
     * @param {function} callback 
     */
    addListener(event, callback) {
        if (!this.#listeners[event]) { this.#listeners[event] = []; }
        this.#listeners[event].push(callback);
    }

    #fireListeners(listeners, ...args) {
        if (listeners) {
            for (const callback of listeners) { callback(...args); }
        }
    }

    #findProblemIndex(problems, severity=null, field=null, message=null) {
        for (let i = 0; i < problems.length; i++) {
            const [pSeverity, pField, pMessage] = problems[i];
            if ((severity == null || pSeverity === severity) &&
                (field == null || pField === field) &&
                (message == null || pMessage === message)) {
                    return i;
            }
        }
        return -1;
    }


    ///// Model Data /////

    #modelDataListeners = {};
    #fireModelDataListeners(property) {
        const newRawValue = this.modelData.get(property);
        const newValue = newRawValue?.toJSON ? newRawValue.toJSON() : newRawValue;
        this.#fireListeners(this.#modelDataListeners[property], property, newValue);
        this.#fireListeners(this.#modelDataListeners[''], property, newValue);
    }
    fireModelDataListeners() {
        for (const property of Object.keys(this.#modelDataListeners)) {
            if (property === 'problems') { this.#fireModelDataProblems(); }
            else if (property !== '') { this.#fireModelDataListeners(property); }
        }
    }
    #fireModelDataProblems() {
        this.#fireListeners(this.#modelDataListeners['problems'], 'problems', this.#modelDataProblems);
    }
    #modelDataObserver(events) {
        for (const event of events) {
            if (event.target === this.modelData) {
                for (const property of event.changes.keys.keys()) {
                    this.#fireModelDataListeners(property);
                }
            } else {
                const property = event.path[0];
                this.#fireModelDataListeners(property);
            }
        }
    }

    /**
     * Add a listener for changes to a property in the model data. The changes
     * can come from anywhere (Yjs or local updates).
     * @param {string} property property name to listen for, empty string for
     *  all properties, or 'problems' for problems with the model data (empty
     *  string does not apply here)
     * @param {function} callback function to call when the property changes,
     *  with signature (property, newValue).
     */
    addModelDataListener(property, callback) {
        if (!this.#modelDataListeners[property]) { this.#modelDataListeners[property] = []; }
        this.#modelDataListeners[property].push(callback);
    }

    /**
     * Update a property in the model data.
     * @param {string} property property name to update
     * @param {*} value new value for the property
     * @param {number|object|null} cursorPos optional cursor position for text properties
     */
    // modelData has:
    //    documentation (Y.Text)
    //    authors (Y.Text)
    //    testDocumentation (Y.Text)
    //    globalCode (Y.Text)
    //    showTestDocumentation (boolean)
    //    readOnly (boolean or array* of fixed strings) (should this be Y.Array instead?)
    updateModelData(property, value, cursorPos=null) {
        if (MODEL_DATA_TEXTS.includes(property)) {
            updateText(this.modelData, property, value, cursorPos);
        } else {
            this.modelData.set(property, value);
        }
    }

    #modelDataProblems = [];

    /**
     * Record a problem with the model data.
     * @param {string} severity severity of the problem ('error' or 'warning')
     * @param {string} field field name where the problem occurred
     * @param {string} message description of the problem
     */
    recordModelDataProblem(severity, field, message) {
        const index = this.#findProblemIndex(this.#modelDataProblems, severity, field, message);
        if (index === -1) {
            this.#modelDataProblems.push([severity, field, message]);
            this.#fireModelDataProblems();
        }
    }

    /**
     * Clear a recorded problem with the model data.
     * @param {string|null} severity severity of the problem ('error' or 'warning'),
     *  or null for any severity
     * @param {string|null} field field name where the problem occurred, or null for any field
     * @param {string|null} message description of the problem, or null for any message
     */
    clearModelDataProblem(severity=null, field=null, message=null) {
        const index = this.#findProblemIndex(this.#modelDataProblems, severity, field, message);
        if (index !== -1) {
            this.#modelDataProblems.splice(index, 1);
            this.#fireModelDataProblems();
        }
    }


    ///// Functions /////

    #funcListeners = {};
    #fireFuncListeners(key, property) {
        const newRawValue = this.functions.get(key).get(property);
        const newValue = newRawValue?.toJSON ? newRawValue.toJSON() : newRawValue;
        this.#fireListeners(this.#funcListeners?.[property], key, property, newValue);
        this.#fireListeners(this.#funcListeners?.[''], key, property, newValue);
    }
    #fireFuncListenersSpecial(key, property, propActual, path) {
        let newRawValue = this.functions.get(key).get(path[0]);
        for (let i = 1; i < path.length; i++) { newRawValue = newRawValue.get(path[i]); }
        const newValue = newRawValue?.toJSON ? newRawValue.toJSON() : newRawValue;
        this.#fireListeners(this.#funcListeners?.[property], key, propActual, newValue);
        this.#fireListeners(this.#funcListeners?.[''], key, propActual, newValue);
    }
    fireFuncListeners(key) {
        for (const property of Object.keys(this.#funcListeners)) {
            if (property === 'problems') { this.#fireFuncProblems(key); }
            else if (property === 'linkProblems') { this.#fireFuncLinkProblems(key); }
            else if (property !== '') { this.#fireFuncListeners(key, property); }
        }
    }
    #fireFuncProblems(key) {
        const problems = this.#funcProblems[key] ?? [];
        this.#fireListeners(this.#funcListeners['problems'], key, 'problems', problems);
    }
    #fireFuncLinkProblems(key) {
        const problems = this.#funcLinkProblems[key] ?? [];
        this.#fireListeners(this.#funcListeners['linkProblems'], key, 'linkProblems', problems);
    }
    #funcAddListeners = [];
    #fireFuncAddListeners(key) {
        const data = this.functions.get(key).toJSON();
        delete data.isTrusted;
        this.#fireListeners(this.#funcAddListeners, key, data);
    }
    #funcRemoveListeners = [];
    #fireFuncRemoveListeners(key) {
        this.#fireListeners(this.#funcRemoveListeners, key);
    }
    #funcObserver(events) {
        for (const event of events) {
            if (event.target === this.functions) {
                for (const [key, {action}] of event.changes.keys) {
                    if (action === 'add') { this.#fireFuncAddListeners(key); }
                    else if (action === 'delete') { this.#fireFuncRemoveListeners(key); }
                    else if (action === 'update') {
                        console.warn('Unexpected update action on Yjs functions map');
                        this.#fireFuncRemoveListeners(key);
                        this.#fireFuncAddListeners(key);
                    }
                }
            } else if (event.path.length === 1) {
                // property update inside a function
                const key = event.path[0];
                for (const property of event.changes.keys.keys()) {
                    this.#fireFuncListeners(key, property);
                }
            } else if (event.path.length === 2) {
                // property update inside a function
                const [key, property] = event.path;
                this.#fireFuncListeners(key, property);
            } else if (event.path.length === 3) {
                // function.property[index] update
                const [key, prop, index] = event.path;
                this.#fireFuncListenersSpecial(key, prop, `${prop}[${index}]`, [prop, index]);
            } else if (event.path.length === 4) {
                // function.property[index].property update
                const [key, prop, index, subprop] = event.path;
                this.#fireFuncListenersSpecial(key, prop, `${prop}[${index}].${subprop}`, [prop, index, subprop]);
            } else {
                console.error('Unexpected event path length in Yjs functions observer:', event.path);
            }
        }
    }

    /**
     * Add a listener for changes to a property of a function. The changes
     * can come from anywhere (Yjs or local updates).
     * @param {string} property property name to listen for, empty string for
     *  all properties, or 'problems'/'linkProblems' for problems with the
     *  function/links (empty string does not apply here)
     * @param {function} callback function to call when the property changes,
     *  with signature (key, property, newValue).
     */
    addFuncListener(property, callback) {
        if (!this.#funcListeners[property]) { this.#funcListeners[property] = []; }
        this.#funcListeners[property].push(callback);
    }

    /**
     * Add a listener for when a function is added. The addition can come from
     * anywhere (Yjs or local updates).
     * @param {function} callback function to call when the function is added,
     *  with signature (key, data).
     */
    addFuncAddListener(callback) { this.#funcAddListeners.push(callback); }

    /**
     * Add a listener for when a function is removed. The removal can come from
     * anywhere (Yjs or local updates).
     * @param {function} callback function to call when the function is removed,
     *  with signature (key).
     */
    addFuncRemoveListener(callback) { this.#funcRemoveListeners.push(callback); }

    /**
     * Add a new function to the model.
     * @param {object} data data for the new function, not including the key
     */
    addFunc(data={}) {
        // ensure unique key
        const keys = Array.from(this.functions.keys()).map(x => parseInt(x));
        const key = (Math.max(-1, ...keys) + 1).toString();
        // add to model
        this.functions.set(key, this.convertFuncData(data));
    }

    /**
     * Convert an object for a function to Yjs-compatible format, according to
     * the FUNC_DATA_TEXTS and FUNC_DATA_ARRAYS constants for converting text
     * properties and arrays of maps.
     * @param {object} data 
     * @returns {Y.Map} Yjs-compatible function data
     */
    convertFuncData(data) {
        if (data instanceof Y.Map) { return data; }
        if (data instanceof Map) { data = Object.fromEntries(data); }
        return new Y.Map(Object.entries(data).map(([prop, val]) => {
            val = FUNC_DATA_TEXTS.includes(prop) ? new Y.Text(val) :
                    FUNC_DATA_ARRAYS.includes(prop) ? new Y.Array(val.map(this.convertFuncData)) :
                    val;
            return [prop, val];
        }));
    }

    #updateFuncProp(map, property, value, cursorPos=null) {
        if (FUNC_DATA_TEXTS.includes(property)) {
            updateText(map, property, value, cursorPos);
        } else {
            map.set(property, value);
        }
    }

    /**
     * Remove a function from the model. Also removes any calls to or from
     * the function.
     * @param {string} key key of the function to remove
     */
    removeFunc(key) {
        this.model.transact(() => {
            for (const other of this.calledFunctions[key] || []) {
                this.calls.delete(`${key}-${other}`);
            }
            for (const other of this.callingFunctions[key] || []) {
                this.calls.delete(`${other}-${key}`);
            }
            this.functions.delete(key);
        });
    }

    /**
     * Remove multiple functions from the model. Also removes any calls to or
     * from the functions.
     * @param {array} keys array of keys of the functions to remove
     */
    removeFuncs(keys) {
        this.model.transact(() => {
            // TODO: utilize calledFunctions and callingFunctions maps
            this.calls.forEach((_, callKey) => {
                const [from, to] = callKey.split('-');
                if (keys.includes(from) || keys.includes(to)) {
                    this.calls.delete(callKey);
                }
            });
            for (const key of keys) { this.functions.delete(key); }
        });
    }

    /**
     * Update a function in the model.
     * @param {string} key key of the function to update
     * @param {string} property property name to update
     * @param {*} value new value for the property
     * @param {number|object|null} cursorPos optional cursor position for text properties
     */
    // Each function has:
    //    name (Y.Text)
    //    desc (Y.Text)
    //    code (Y.Text)
    //    testCode (Y.Text)
    //    params (Y.Array of Y.Map with name (Y.Text), desc (Y.Text), and type (string))
    //    returns (Y.Array of Y.Map with desc (Y.Text) and type (string))
    //       the last two are accessed via:
    //           updateFunc(key, 'params[0].name', '...')  (can also use 'params[0]' and 'params' to update many at once)
    //           updateFunc(key, 'returns[0].name', '...')
    //    io (fixed string)
    //    testable (boolean)
    //    showCode (boolean)
    //    showTestCode (boolean)
    //    readOnly (boolean or array of fixed strings; not a Y.Array since edited infrequently)
    updateFunc(key, property, value, cursorPos=null) {
        const func = this.functions.get(key);
        if (!func) { console.error(`Function with key ${key} does not exist`); return; }
        if (FUNC_DATA_ARRAYS.some(arr => property.startsWith(arr))) {
            const [type, index, subprop] = this.parseFuncProperty(property);
            if (index == null) {
                // update all elements
                func.set(type, new Y.Array(value.map(this.convertFuncData)));
            } else {
                this.model.transact(() => {
                    const needNewArray = !func.has(type);
                    const arr = func.get(type) ?? new Y.Array();
                    if (needNewArray) { func.set(type, arr); }
                    if (!needNewArray &&  index < arr.length) {
                        const ymap = arr.get(index);
                        if (subprop == null) {
                            // update all subproperties
                            for (const [subprop, subvalue] of Object.entries(value)) {
                                this.#updateFuncProp(ymap, subprop, subvalue);
                            }
                            for (const subprop of ymap.keys()) {
                                if (!(subprop in value)) { ymap.delete(subprop); }
                            }
                        } else {
                            // update subproperty
                            this.#updateFuncProp(ymap, subprop, value, cursorPos);
                        }
                    } else {
                        if (subprop == null) {
                            // convert value to Y.Map and add to array
                            arr.insert(index, [this.convertFuncData(value)]);
                        } else {
                            // create new Y.Map and set subproperty
                            const ymap = new Y.Map();
                            arr.insert(index, [ymap]);
                            this.#updateFuncProp(ymap, subprop, value, cursorPos);
                        }
                    }
                });
            }
        } else {
            this.#updateFuncProp(func, property, value, cursorPos);
        }
    }

    /**
     * Parse the property name in a function. For params and returns, this will return
     * [type, index, subprop], otherwise it will return just the property.
     * @param {string} property property name to parse
     * @returns {[string, number|null, string|null]} value of the property
     */
    parseFuncProperty(property) {
        const result = /(params|returns)(\[(\d+)\](\.(name|desc|type))?)?/.exec(property);
        if (result) {
            const [, type, , index, , subprop] = result;
            return [type, index ? parseInt(index) : null, subprop ?? null];
        }
        return [property, null, null];
    }


    /**
     * Add an item to an array value of a function.
     * @param {string} key key of the function
     * @param {string} field 'params' or 'returns'
     * @param {number} index index of the parameter or return value to add, or
     * -1 to add to the end
     */
    addFuncItem(key, field, index=-1) {
        const func = this.functions.get(key);
        if (!func) { console.error(`Function with key ${key} does not exist`); return; }
        const needNewArray = !func.has(field);
        const arr = func.get(field) ?? new Y.Array();
        this.model.transact(() => {
            if (needNewArray) { func.set(field, arr); }
            if (index === -1) { index = needNewArray ? 0 : arr.length; }
            arr.insert(index, [new Y.Map()]);
        });
    }

    /**
     * Remove an item from an array value of a function.
     * @param {string} key key of the function
     * @param {string} field 'params' or 'returns'
     * @param {number} index index of the parameter or return value to remove
     */
    removeFuncItem(key, field, index) {
        const arr = this.functions.get(key).get(field);
        if (arr && index < arr.length) { arr.delete(index, 1); }
    }

    /**
     * Move an item in an array value of a function.
     * @param {string} key key of the function
     * @param {string} field 'params' or 'returns'
     * @param {number} fromIndex original index of the item
     * @param {number} toIndex new index to move the item to
     */
    moveFuncItem(key, field, fromIndex, toIndex) {
        const arr = this.functions.get(key).get(field);
        if (arr && fromIndex < arr.length) {
            const item = arr.get(fromIndex).clone();
            this.model.transact(() => {
                arr.delete(fromIndex, 1);
                arr.insert(toIndex, [item]);
            });
        }
    }

    #funcProblems = {};
    #funcLinkProblems = {};
    
    /**
     * Set the problems of a function.
     * @param {string} key key of the function
     * @param {[string string string][]} problems array of [severity, field, message]
     *  for the function
     */
    setFuncProblems(key, problems) {
        if (!this.#funcProblems[key]) { this.#funcProblems[key] = []; }
        this.#funcProblems[key] = [...problems];
        this.#fireFuncProblems(key);
    }

    /**
     * Get the problems of a function.
     * @param {string} key key of the function
     * @returns {[string, string, string][]} array of [severity, field, message]
     *  for the function
     */
    getFuncProblems(key) {
        return this.#funcProblems[key] || [];
    }

    /**
     * Set the link problems of a function.
     * @param {string} key key of the function
     * @param {[string, string, string][]} problems array of [severity, field, message]
     *  for the function's links
     */
    setFuncLinkProblems(key, problems) {
        if (!this.#funcLinkProblems[key]) { this.#funcLinkProblems[key] = []; }
        this.#funcLinkProblems[key] = [...problems];
        this.#fireFuncLinkProblems(key);
    }

    /**
     * Get the link problems of a function.
     * @param {string} key key of the function
     * @returns {[string, string, string][]} array of [severity, field, message]
     *  for the function's links
     */
    getFuncLinkProblems(key) {
        return this.#funcLinkProblems[key] || [];
    }


    ///// Calls /////
    // Map of functions keys to array of functions they call
    // Kept updated when the Yjs calls map is updated
    calledFunctions = {};
    // Map of functions keys to array of functions they are called by
    // Kept updated when the Yjs calls map is updated
    callingFunctions = {};

    #callListeners = [];
    #fireCallListeners(action, oldFrom, oldTo, newFrom, newTo) {
        this.#fireListeners(this.#callListeners, action, oldFrom, oldTo, newFrom, newTo);
    }
    #callProblems = {};
    #fireCallProblems(from, to) {
        const problems = this.#callProblems[`${from}-${to}`] ?? [];
        this.#fireListeners(this.#callListeners, 'problems', from, to, problems);
    }
    #push(arr, key, item) {
        if (!arr[key]) { arr[key] = []; }
        arr[key].push(item);
    }
    #remove(arr, key, item) {
        if (arr[key]) {
            arr[key] = arr[key].filter(x => x !== item);
        }
    }
    #addCall(key) {
        const [from, to] = key.split('-');
        this.#push(this.calledFunctions, from, to);
        this.#push(this.callingFunctions, to, from);
        this.#fireCallListeners('add', null, null, from, to);
    }
    #deleteCall(key) {
        const [from, to] = key.split('-');
        this.#remove(this.calledFunctions, from, to);
        this.#remove(this.callingFunctions, to, from);
        this.#fireCallListeners('delete', from, to, null, null);
    }
    #updateCall(oldKey, newKey) {
        const [oldFrom, oldTo] = oldKey.split('-');
        const [newFrom, newTo] = newKey.split('-');
        this.#remove(this.calledFunctions, oldFrom, oldTo);
        this.#remove(this.callingFunctions, oldTo, oldFrom);
        this.#push(this.calledFunctions, newFrom, newTo);
        this.#push(this.callingFunctions, newTo, newFrom);
        this.#fireCallListeners('update', oldFrom, oldTo, newFrom, newTo);
    }
    #callObserver(event) {
        let lastDelete = null; // used to track delete + add as update
        for (const [key, {action}] of event.changes.keys) {
            if (action === 'add') {
                if (lastDelete !== null) {
                    // treat as update
                    this.#updateCall(lastDelete, key);
                    lastDelete = null;
                } else { this.#addCall(key); }
            } else if (action === 'delete') {
                if (lastDelete !== null) { this.#deleteCall(lastDelete); } // fire previous delete
                lastDelete = key;
            } else if (action === 'update') { console.warn('Unexpected update action on Yjs calls map'); }
        }
        if (lastDelete !== null) { this.#deleteCall(lastDelete); } // fire last delete
    }

    /**
     * Add a listener for changes to the calls in the model. The changes
     * can come from anywhere (Yjs or local updates).
     * @param {function} callback function to call when a call is added,
     *  removed, or updated, with signature (action, oldFrom, oldTo, newFrom,
     *  newTo), where action is 'problems', 'add', 'delete', or 'update'. If
     *  the action is 'problems', oldFrom and oldTo are the from/to of the
     *  call, and newFrom is the array of problems.
     */
    addFuncCallListener(callback) {
        this.#callListeners.push(callback);
    }

    /**
     * Add a new call to the model. 
     * @param {string} from key of the from function
     * @param {string} to key of the to function
     */
    addFuncCall(from, to) {
        this.calls.set(`${from}-${to}`, true);
    }

    /**
     * Remove a call from the model.
     * @param {string} from key of the from function
     * @param {string} to key of the to function
     */
    removeFuncCall(from, to) {
        this.calls.delete(`${from}-${to}`);
    }

    /**
     * Remove multiple calls from the model.
     * @param {array} callArray array of {from, to} objects for the calls to remove
     */
    removeFuncCalls(callArray) {
        this.model.transact(() => {
            for (const {from, to} of callArray) {
                this.calls.delete(`${from}-${to}`);
            }
        });
    }

    /**
     * Update a call in the model.
     * @param {string} oldFrom key of the old from function
     * @param {string} oldTo key of the old to function
     * @param {string|null} newFrom key of the new from function or null to keep the same
     * @param {string|null} newTo key of the new to function or null to keep the same
     */
    updateFuncCall(oldFrom, oldTo, newFrom, newTo) {
        newFrom = newFrom ?? oldFrom;
        newTo = newTo ?? oldTo;
        if (newFrom === oldFrom && newTo === oldTo) { return; }
        this.model.transact(() => {
            this.calls.delete(`${oldFrom}-${oldTo}`);
            this.calls.set(`${newFrom}-${newTo}`, true);
        });
    }

    /**
     * Gets the problems of a call.
     * @param {string} from key of the from function
     * @param {string} to key of the to function
     * @returns {[string, string, string][]} array of [severity, field, message]
     *  for the call
     */
    getFuncCallProblems(from, to) {
        return this.#callProblems[`${from}-${to}`] || [];
    }

    /**
     * Set the problems of a call.
     * @param {string} from key of the from function
     * @param {string} to key of the to function
     * @param {[string, string, string][]} problems array of [severity, field, message]
     *  for the call
     */
    setFuncCallProblems(from, to, problems) {
        this.#callProblems[`${from}-${to}`] = [...problems];
        this.#fireCallProblems(from, to);
    }
}

/**
 * Update a Y.Text property in a Y.Map.
 * @param {Y.Map} ymap 
 * @param {string} property 
 * @param {string|*} value 
 * @param {number|object|null} cursorPos 
 */
function updateText(ymap, property, value, cursorPos=null) {
    if (typeof value === 'string') {
        const ytext = ymap.get(property);
        if (ytext && ytext instanceof Y.Text) {
            const cur = ytext.toString();
            if (cur === value) { return; } // no change
            ytext.applyDelta(diffToDelta(diff(cur, value, cursorPos)));
        } else {
            ymap.set(property, new Y.Text(value));
        }
    }
}

/**
 * Convert a fast-diff result to a Y.Text delta.
 * @param {array} diffResult result from a fast-diff operation
 * @returns {array} Y.Text delta
 */
function diffToDelta(diffResult) {
  return diffResult.map(([op, value]) =>
    op === diff.INSERT ? { insert: value }
      : op === diff.EQUAL ? { retain: value.length }
      : op === diff.DELETE ? { delete: value.length } : null
  );
}