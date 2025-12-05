/** Utility functions. */

/**
 * Deep equality check for two values, recursively checking objects and arrays.
 * @param {*} a
 * @param {*} b 
 * @returns {boolean} True if a and b are deeply equal, false otherwise.
 */
export function deepEquals(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) && Array.isArray(b) && a.length == b.length && a.every((x, i) => deepEquals(x, b[i]))) return true;
    if (Object.keys(a).length !== Object.keys(b).length) return false;
    return Object.keys(a).every(key => (key in b) && deepEquals(a[key], b[key]));
}

/**
 * Deep copy an object or value. Must be JSON-serializable.
 * @param {object} obj The object or value to copy.
 * @returns {object} A deep copy of the input object or value.
 */
export function dup(obj) { return JSON.parse(JSON.stringify(obj)); }

/**
 * Load an SVG file from the given path and insert it into the given element.
 * @param {string} path The path to the SVG file.
 * @param {HTMLElement} elem The element to insert the SVG into.
 * @param {string} fallback Fallback text to display if loading fails, default is empty string.
 */
export function loadSVG(path, elem, fallback='') {
    fetch(path).then(response => response.text())
        .then(svg => { elem.innerHTML = svg; })
        .catch(err => {
            console.error(`Error loading SVG from ${path}:`, err);
            elem.textContent = fallback;
        });
}

/**
 * Escape HTML special characters in a string.
 * @param {string} unsafe The string to escape.
 * @returns {string} The escaped string.
 */
export function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Create an <option> element for a <select> input.
 * @param {string} value The value attribute of the option.
 * @param {string} text The display text of the option.
 * @returns {HTMLOptionElement} The created option element.
 */
export function makeOption(value, text) {
    let option = document.createElement("option");
    option.value = value;
    option.text = text || value;
    return option;
}

/**
 * Convert an HTML string to a DOM node.
 * @param {string} html The HTML string.
 * @returns {HTMLElement} The resulting DOM node.
 */
export function htmlToNode(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.firstElementChild;
}

/**
 * Check if the current platform is macOS.
 * @returns {boolean} True if the platform is macOS, false otherwise.
 */
export function isMacOS() {
    const platform = window.navigator?.userAgentData?.platform || window.navigator.platform;
    return platform.toLowerCase().indexOf('mac') !== -1;
}
