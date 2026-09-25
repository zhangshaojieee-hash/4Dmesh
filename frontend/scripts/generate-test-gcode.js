import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function generateGcode(lines, filename) {
  const outputPath = path.join(__dirname, '..', '..', 'uploads', 'slices', filename);
  const stream = fs.createWriteStream(outputPath);
  
  // Header
  stream.write('; Generated test G-code\n');
  stream.write('; Total lines: ' + lines + '\n');
  stream.write('G28 ; Home\n');
  stream.write('G1 Z0.2 F5000\n');
  
  let currentLine = 4;
  let z = 0.2;
  let e = 0;
  const layerHeight = 0.2;
  const layerLines = 250; // ~250 lines per layer
  
  while (currentLine < lines) {
    // Layer change
    if (currentLine % layerLines === 0) {
      z += layerHeight;
      stream.write(`G1 Z${z.toFixed(2)} F5000\n`);
      currentLine++;
    }
    
    // Square pattern
    const size = 100;
    const points = [
      [10, 10], [size-10, 10], [size-10, size-10], [10, size-10], [10, 10]
    ];
    
    for (let i = 0; i < points.length && currentLine < lines; i++) {
      const [x, y] = points[i];
      e += 0.05;
      stream.write(`G1 X${x} Y${y} E${e.toFixed(3)} F1500\n`);
      currentLine++;
    }
    
    // Inner square
    const innerSize = 60;
    const innerPoints = [
      [30, 30], [innerSize, 30], [innerSize, innerSize], [30, innerSize], [30, 30]
    ];
    
    for (let i = 0; i < innerPoints.length && currentLine < lines; i++) {
      const [x, y] = innerPoints[i];
      e += 0.05;
      stream.write(`G1 X${x} Y${y} E${e.toFixed(3)} F1500\n`);
      currentLine++;
    }
    
    // Travel move
    if (currentLine < lines) {
      stream.write(`G0 X${Math.random() * 100} Y${Math.random() * 100}\n`);
      currentLine++;
    }
  }
  
  stream.write('M84 ; Disable motors\n');
  stream.end();
  
  console.log(`Generated ${filename} with ~${lines} lines`);
}

// Generate test files
generateGcode(50000, 'test-50k.gcode');
generateGcode(100000, 'test-100k.gcode');
generateGcode(200000, 'test-200k.gcode');
