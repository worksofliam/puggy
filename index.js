
const { writeFileSync } = require('fs');
const PuggyCompiler = require('./puggy');
const path = require('path');

const inputFile = process.argv[2];

if (inputFile) {
  const pc = new PuggyCompiler(path.basename(inputFile));
  pc.parse(inputFile);
  
  const result = pc.getAsHtmlFile({
    images: [1, 2, 3, 4, 5, 6, 7, 8, 9]
  });

  writeFileSync(path.join(path.dirname(inputFile), `index.html`), result);
}