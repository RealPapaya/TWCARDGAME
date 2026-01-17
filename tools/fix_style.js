const fs = require('fs');
const path = require('path');

const stylePath = path.join(__dirname, '../style.css');
let content = fs.readFileSync(stylePath, 'utf8');

// Medieval Button Style Definition
const medievalButtonStyle = `.neon-button {
    background: linear-gradient(to bottom, #4a3728, #2d1e16);
    border: 3px solid #8b7355; /* Bronze/Wood border */
    border-radius: 8px;
    color: #f1e4d1; /* Parchment text */
    padding: 15px 40px;
    font-size: 22px;
    font-weight: 700;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 2px;
    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    box-shadow: 
        inset 0 1px 0 rgba(255,255,255,0.1),
        0 4px 0 #1a120c,
        0 6px 12px rgba(0,0,0,0.6);
    position: relative;
    overflow: hidden;
    text-shadow: 2px 2px 2px rgba(0,0,0,0.8);
    font-family: 'Noto Serif TC', serif;
}

.neon-button::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: repeating-linear-gradient(
        45deg,
        rgba(255,255,255,0.03),
        rgba(255,255,255,0.03) 10px,
        rgba(0,0,0,0.03) 10px,
        rgba(0,0,0,0.03) 20px
    );
    pointer-events: none;
}

.neon-button:hover {
    background: linear-gradient(to bottom, #5d4633, #3d2a1e);
    color: #fff;
    transform: translateY(-2px);
    box-shadow: 
        inset 0 1px 0 rgba(255,255,255,0.2),
        0 6px 0 #1a120c,
        0 8px 15px rgba(0,0,0,0.7);
    border-color: #a89070;
}

.neon-button:active {
    transform: translateY(2px);
    box-shadow: 
        inset 0 2px 5px rgba(0,0,0,0.5),
        0 2px 0 #1a120c,
        0 3px 6px rgba(0,0,0,0.5);
}

.neon-button.secondary {
    background: linear-gradient(to bottom, #d2b48c, #c19a6b); /* Parchment/Tan */
    border-color: #8b7355;
    color: #3e2723;
    text-shadow: 0 1px 0 rgba(255,255,255,0.3);
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.2),
        0 4px 0 #4a3728,
        0 6px 12px rgba(0, 0, 0, 0.6);
}

.neon-button.secondary:hover {
    background: linear-gradient(to bottom, #e0c9a6, #d2b48c);
    border-color: #a89070;
    color: #2d1e16;
}

.neon-button.danger {
    background: linear-gradient(to bottom, #7d2a1e, #4a1510);
    border-color: #9b3a2a;
    color: #ffcccc;
}

.neon-button.danger:hover {
    background: linear-gradient(to bottom, #9b3a2a, #621d15);
    border-color: #c04a35;
}

.neon-button:disabled, .neon-button.disabled-mode {
    background: #333 !important;
    border-color: #222 !important;
    color: #555 !important;
    box-shadow: none !important;
    cursor: not-allowed;
    text-shadow: none !important;
    transform: none !important;
}`;

// Identify the block to replace. 
// We look for ".neon-button {" and the end of ".neon-button.disabled-mode { ... }" block.
// Since the file has garbage, we'll try to find the start and end by index.

const startMarker = '.neon-button {';
const endMarker = 'transform: none !important;\r\n}'; // Approximate end
// Actually, let's just find the start of .neon-button and replacing until we see .sub-title
const limitMarker = '.sub-title {';

const startIndex = content.indexOf(startMarker);
const limitIndex = content.indexOf(limitMarker);

if (startIndex !== -1 && limitIndex !== -1 && limitIndex > startIndex) {
    console.log('Found neon-button block.');
    // Extract the part to replace
    // We want to replace from startIndex to just before limitIndex
    // But we need to be careful about whitespace.
    // Let's verify what's between them.

    // Construct new content
    const newContent = content.substring(0, startIndex) + medievalButtonStyle + '\n\n' + content.substring(limitIndex);

    fs.writeFileSync(stylePath, newContent, 'utf8');
    console.log('style.css updated successfully.');
} else {
    console.error('Could not locate the neon-button block boundaries.');
    console.log('Start Index:', startIndex);
    console.log('Limit Index:', limitIndex);
}
