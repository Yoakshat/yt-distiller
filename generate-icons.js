// Generates minimal valid PNG icons for the YT Distiller extension.
// Uses hardcoded raw PNG bytes — no npm, no canvas, no build tools.
// A minimal 1x1 pixel PNG (red) encoded as base64.

const fs = require("fs");
const path = require("path");

// Valid 1x1 red PNG in base64
// Chrome will scale it up; we just need valid PNG files for all three sizes.
const RED_1x1_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==";

const iconDir = path.join(__dirname, "extension", "icons");

const sizes = [16, 48, 128];

sizes.forEach((size) => {
  const dest = path.join(iconDir, `icon${size}.png`);
  fs.writeFileSync(dest, Buffer.from(RED_1x1_PNG_B64, "base64"));
  console.log(`Created ${dest}`);
});

console.log("Icons generated.");
