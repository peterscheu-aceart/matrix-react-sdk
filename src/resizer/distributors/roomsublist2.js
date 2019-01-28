/*
Copyright 2019 New Vector Ltd

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import FixedDistributor from "./fixed";

// const allowWhitespace = true;
const handleHeight = 1;

function clamp(height, min, max) {
    if (height > max) return max;
    if (height < min) return min;
    return height;
}

export class Layout {
    constructor(applyHeight, initialSizes, collapsedState) {
        // callback to set height of section
        this._applyHeight = applyHeight;
        // list of {id, count} objects,
        // determines sections and order of them
        this._sections = [];
        // stores collapsed by id
        this._collapsedState = Object.assign({}, collapsedState);
        // total available height to the layout
        // (including resize handles, ...)
        this._availableHeight = 0;
        // heights stored by section section id
        this._sectionHeights = Object.assign({}, initialSizes);
        // in-progress heights, while dragging. Committed on mouse-up.
        this._heights = [];
    }

    setAvailableHeight(newSize) {
        this._availableHeight = newSize;
        // needs more work
        this._applyNewSize();
    }

    expandSection(id, height) {
        this._collapsedState[id] = false;
        this._applyNewSize();
        this.openHandle(id).setHeight(height).finish();
    }

    collapseSection(id) {
        this._collapsedState[id] = true;
        this._applyNewSize();
    }

    update(sections, availableHeight) {
        let heightChanged = false;

        if (Number.isFinite(availableHeight) && availableHeight !== this._availableHeight) {
            heightChanged = true;
            this._availableHeight = availableHeight;
        }

        const sectionsChanged =
            sections.length !== this._sections.length ||
            sections.some((a, i) => {
                const b = this._sections[i];
                return a.id !== b.id || a.count !== b.count;
            });

        if (!heightChanged && !sectionsChanged) {
            return;
        }

        this._sections = sections;
        const totalHeight = this._getAvailableHeight();
        this._sections.forEach((section, i) => {
            if (!this._sectionHeights[section.id]) {
                this._sectionHeights[section.id] = clamp(
                    totalHeight / this._sections.length,
                    this._getMinHeight(i),
                    this._getMaxHeight(i),
                );
            }
        });
        this._applyNewSize();
    }

    openHandle(id) {
        const index = this._getSectionIndex(id);
        return new Handle(this, index, this._sectionHeights[id]);
    }

    _getAvailableHeight() {
        const nonCollapsedSectionCount = this._sections.reduce((count, section) => {
            const collapsed = this._collapsedState[section.id];
            return count + (collapsed ? 0 : 1);
        }, 0);
        return this._availableHeight - ((nonCollapsedSectionCount - 1) * handleHeight);
    }

    _applyNewSize() {
        const newHeight = this._getAvailableHeight();
        const currHeight = this._sections.reduce((sum, section) => {
            return sum + this._sectionHeights[section.id];
        }, 0);
        const offset = newHeight - currHeight;
        this._heights = this._sections.map((section) => this._sectionHeights[section.id]);
        const sections = this._sections.map((_, i) => i);
        this._applyOverflow(-offset, sections, true);
        this._applyHeights();
        this._commitHeights();
    }

    _getSectionIndex(id) {
        return this._sections.findIndex((s) => s.id === id);
    }

    _getMaxHeight(i) {
        const section = this._sections[i];
        const collapsed = this._collapsedState[section.id];

        if (collapsed) {
            return this._sectionHeight(0);
        } else {
            return 100000;
            // return this._sectionHeight(section.count);
        }
    }

    _sectionHeight(count) {
        return 36 + (count === 0 ? 0 : 4 + (count * 34));
    }

    _getMinHeight(i) {
        const section = this._sections[i];
        const collapsed = this._collapsedState[section.id];
        const maxItems = collapsed ? 0 : 1;
        return this._sectionHeight(Math.min(section.count, maxItems));
    }

    _applyOverflow(overflow, sections, blend) {
        // take the given overflow amount, and applies it to the given sections.
        // calls itself recursively until it has distributed all the overflow
        // or run out of unclamped sections.

        const unclampedSections = [];

        let overflowPerSection = blend ? (overflow / sections.length) : overflow;
        for (const i of sections) {
            const newHeight = clamp(
                this._heights[i] - overflowPerSection,
                this._getMinHeight(i),
                this._getMaxHeight(i),
            );
            if (newHeight == this._heights[i] - overflowPerSection) {
                unclampedSections.push(i);
            }
            // when section is growing, overflow increases?
            // 100 -= 200 - 300
            // 100 -= -100
            // 200
            overflow -= this._heights[i] - newHeight;
            this._heights[i] = newHeight;
            if (!blend) {
                overflowPerSection = overflow;
                if (Math.abs(overflow) < 1.0) break;
            }
        }

        if (Math.abs(overflow) > 1.0 && unclampedSections.length > 0) {
            // we weren't able to distribute all the overflow so recurse and try again
            overflow = this._applyOverflow(overflow, unclampedSections, blend);
        }

        return overflow;
    }

    _rebalanceAbove(anchor, overflowAbove) {
        if (Math.abs(overflowAbove) > 1.0) {
            const sections = [];
            for (let i = anchor - 1; i >= 0; i--) {
                sections.push(i);
            }
            overflowAbove = this._applyOverflow(overflowAbove, sections);
        }
        return overflowAbove;
    }

    _rebalanceBelow(anchor, overflowBelow) {
        if (Math.abs(overflowBelow) > 1.0) {
            const sections = [];
            for (let i = anchor + 1; i < this._sections.length; i++) {
                sections.push(i);
            }
            overflowBelow = this._applyOverflow(overflowBelow, sections);
        }
        return overflowBelow;
    }

    // @param offset the amount the anchor is moved from what is stored in _sectionHeights, positive if downwards
    // if we're clamped, return the offset we should be clamped at.
    _relayout(anchor = 0, offset = 0, clamped = false) {
        this._heights = this._sections.map((section) => this._sectionHeights[section.id]);
        // are these the amounts the items above/below shrank/grew and need to be relayouted?
        let overflowAbove;
        let overflowBelow;
        const maxHeight = this._getMaxHeight(anchor);
        const minHeight = this._getMinHeight(anchor);
        // new height > max ?
        if (this._heights[anchor] + offset > maxHeight) {
            // we're pulling downwards and clamped
            // overflowAbove = minus how much are we above max height
            overflowAbove = (maxHeight - this._heights[anchor]) - offset;
            overflowBelow = offset;
        } else if (this._heights[anchor] + offset < minHeight) { // new height < min?
            // we're pulling upwards and clamped
            overflowAbove = (minHeight - this._heights[anchor]) - offset;
            overflowBelow = offset;
        } else {
            overflowAbove = 0;
            overflowBelow = offset;
        }
        this._heights[anchor] = clamp(this._heights[anchor] + offset, minHeight, maxHeight);

        // these are reassigned the amount of overflow that could not be rebalanced
        // meaning we dragged the handle too far and it can't follow the cursor anymore
        overflowAbove = this._rebalanceAbove(anchor, overflowAbove);
        overflowBelow = this._rebalanceBelow(anchor, overflowBelow);

        if (!clamped) { // to avoid risk of infinite recursion
            // clamp to avoid overflowing or underflowing the page
            if (Math.abs(overflowAbove) > 1.0) {
                // here we do the layout again with offset - the amount of space we took too much
                this._relayout(anchor, offset + overflowAbove, true);
                return offset + overflowAbove;
            }

            if (Math.abs(overflowBelow) > 1.0) {
                // here we do the layout again with offset - the amount of space we took too much
                this._relayout(anchor, offset - overflowBelow, true);
                return offset - overflowBelow;
            }
        }

        this._applyHeights();
        return undefined;
    }

    _applyHeights() {
        // apply the heights
        for (let i = 0; i < this._sections.length; i++) {
            const section = this._sections[i];
            this._applyHeight(section.id, this._heights[i]);
        }
    }

    _commitHeights() {
        this._sections.forEach((section, i) => {
            this._sectionHeights[section.id] = this._heights[i];
        });
    }
}

class Handle {
    constructor(layout, anchor, height) {
        this._layout = layout;
        this._anchor = anchor;
        this._initialHeight = height;
    }

    setHeight(height) {
        this._layout._relayout(this._anchor, height - this._initialHeight);
        return this;
    }

    finish() {
        this._layout._commitHeights();
        return this;
    }
}

export class Distributor extends FixedDistributor {
    constructor(item, cfg) {
        super(item);
        const layout = cfg.layout;
        this._handle = layout.openHandle(item.id);
    }

    finish() {
        this._handle.finish();
    }

    resize(height) {
        this._handle.setHeight(height);
    }
}
