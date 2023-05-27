
const { writeFileSync, readFileSync } = require('fs');
const PuggyCompiler = require('./puggy');

var filename = 'my-file.pug';
// var src = [
//   `- let myvar = 'Hi'`,
//   'div#abcd', 
//   `  if myvar === 'Hi'`,
//   `    span Hello world`,
//   `  else`,
//   `    span=myvar`,
//   `span Always here`,
//   `  | and here`,
//   `a(href=myvar) Home`
// ].join(`\n`);

let src = readFileSync(`index.pug`, {encoding: `utf-8`});

const pc = new PuggyCompiler(filename);

pc.parse(src);
const result = pc.getAsHtmlFile();

console.log(result);
writeFileSync(`index.html`, result);
