
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/legacy/app.js');
console.log(`Reading ${filePath}...`);

let content = fs.readFileSync(filePath, 'utf8');
let lines = content.split('\n');

function findLine(pattern, startIdx = 0) {
    for (let i = startIdx; i < lines.length; i++) {
        if (lines[i].includes(pattern)) {
            return i;
        }
    }
    return -1;
}

const ranges = [];

// Range 1: formatDesc
const start1 = findLine('function formatDesc');
const end1Marker = findLine('function renderMana', start1); // Should be after
if (start1 !== -1 && end1Marker !== -1) {
    // Delete up to renderMana, leaving 1 empty line
    // formatDesc ends at end1Marker - 2 essentially (blank line at -1)
    ranges.push({ start: start1, end: end1Marker - 1 });
    console.log(`Marked formatDesc for deletion: ${start1 + 1} to ${end1Marker}`);
} else {
    console.error('Could not find formatDesc range');
}

// Range 2: Drag Logic & Visuals
const start2 = findLine('function onDragStart');
const end2Marker = findLine("document.addEventListener('contextmenu'", start2);
if (start2 !== -1 && end2Marker !== -1) {
    ranges.push({ start: start2, end: end2Marker - 1 });
    console.log(`Marked Drag Logic for deletion: ${start2 + 1} to ${end2Marker}`);
} else {
    console.error('Could not find Drag Logic range');
}

// Range 3: Remaining Visuals
const start3 = findLine('function triggerFullBoardHealAnimation');
// end3Marker: we look for where showDamageNumber ENDS.
// It is followed by `// Make function globally accessible`
const end3Marker = findLine('// Make function globally accessible', start3);
if (start3 !== -1 && end3Marker !== -1) {
    ranges.push({ start: start3, end: end3Marker - 1 });
    console.log(`Marked Visuals 2 for deletion: ${start3 + 1} to ${end3Marker}`);
} else {
    console.error('Could not find Visuals 2 range');
}

// Sort ranges descending to delete safely
ranges.sort((a, b) => b.start - a.start);

let deletedCount = 0;
ranges.forEach(r => {
    // Remove lines
    const count = r.end - r.start;
    lines.splice(r.start, count);
    deletedCount += count;
});

console.log(`Deleted ${deletedCount} lines.`);

const newContent = lines.join('\n');
fs.writeFileSync(filePath, newContent);
console.log('Done.');
