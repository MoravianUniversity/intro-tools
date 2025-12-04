/**
 * Functions for handling global settings.
 */

export const SHOW_COLLAPSE_BUTTON = localStorage.getItem('func-planner-show-collapse-button') === 'true';
export const ALLOW_RECURSIVE = localStorage.getItem('func-planner-allow-recursive') === 'true';

export function setSettings(showCollapseButton, allowRecursive) {
    if (showCollapseButton === SHOW_COLLAPSE_BUTTON && allowRecursive === ALLOW_RECURSIVE) { return; }
    localStorage.setItem('func-planner-show-collapse-button', showCollapseButton ? 'true' : 'false');
    localStorage.setItem('func-planner-allow-recursive', allowRecursive ? 'true' : 'false');
    location.reload(); // reload to apply settings
}
