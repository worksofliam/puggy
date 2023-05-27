
const { writeFileSync } = require('fs');
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

let src = [
  `- let mypet = 'cow'`,
  `mixin pet(name)`,
  `  li.pet=name`,
  `ul`,
  `  +pet(mypet)`,
  `  +pet('cat')`,
  `  +pet('dog')`,
  `  +pet('pig')`,
].join(`\n`);

const pc = new PuggyCompiler(filename);

pc.parse(src);
const result = pc.getAsHtmlFile();

console.log(result);
writeFileSync(`index.html`, result);
