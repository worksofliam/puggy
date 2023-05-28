
const { writeFileSync } = require('fs');
const PuggyCompiler = require('./puggy');
const path = require('path');

const inputFile = process.argv[2];

if (input) {
  const pc = new PuggyCompiler(path.basename(inputFile));

  pc.parse(inputFile);
  const result = pc.getAsHtmlFile();

  writeFileSync(path.join(path.dirname(inputFile), `index.html`), result);
}