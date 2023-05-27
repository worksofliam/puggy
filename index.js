
const { writeFileSync } = require('fs');
const PuggyCompiler = require('./puggy');

var filename = 'my-file.pug';
var src = [
  `- let myvar = 'Hi'`,
  'div#abcd', 
  `  if myvar === 'Hi'`,
  `    span Hello world`,
  `  else`,
  `    span=myvar`,
  `span Always here`,
  `  | and here`,
  `a(href=myvar) Home`
].join(`\n`);

const pc = new PuggyCompiler();

pc.parse(src, filename);
const result = pc.getAsHtmlFile();

console.log(result);
writeFileSync(`index.html`, result);
