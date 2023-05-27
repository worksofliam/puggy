const parse = require('pug-parser');
const lex = require('pug-lexer');
const generateCode = require('pug-code-gen');
const wrap = require('pug-runtime/wrap');
const crypto = require("crypto");
const { writeFileSync } = require('fs');

function randomId() {
  return crypto.randomBytes(8).toString("hex");
}

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
var tokens = lex(src, {filename});

var ast = parse(tokens, {filename, src});

// Right now, we only look for variables at a top level

/** @type {{name: string, value: string}[]} */
let variables = [];

/** @type {{id: string, expression: string, when: {equals: string, id: string}[]}[]} */
let conditionals = [];

/** @type {{id: string, attr: string, expression: string}[]} */
let boundValues = [];

/** @type {{[name: string]: string[]}} */
let variableEvents = {}

if (ast.nodes) {
  function generateDiv(id, nodes, hidden = false) {
    return {
      type: "Tag",
      name: "div",
      selfClosing: false,
      block: {
        type: "Block",
        nodes,
      },
      attrs: [
        {
          name: "id",
          val: `'${id}'`,
          mustEscape: false,
        },
        ...(hidden ? [{
          name: "style",
          val: "\"display: none;\"",
          mustEscape: true,
        }] : [])
      ],
      attributeBlocks: [],
      isInline: false,
    }
  }

  /**
   * @param {any[]} nodes 
   */
  function parseBlock(nodes) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      switch (node.type) {
        case `Conditional`:
          const { test, consequent, alternate } = node;

          const trueId = randomId();
          const falseId = randomId();
  
          // Capture what makes this conditional part show
          const conditionEvent = randomId();
          conditionals.push({
            id: conditionEvent,
            expression: test,
            when: [
              {equals: `true`, id: trueId},
              {equals: `false`, id: falseId}
            ]
          });
  
          // Then, we need to capture if this test contains any variables we know about
          // so we can easily trigger the event if this variable changes
          test.split(` `).forEach(w => {
            if (variables.some(v => v.name === w)) {
              if (!variableEvents[w]) variableEvents[w] = [];
  
              variableEvents[w].push(conditionEvent);
            }
          });
  
          const trueDiv = generateDiv(trueId, consequent.nodes, true);
          nodes.splice(i, 1, trueDiv);


          parseBlock(consequent.nodes);
  
          if (alternate) {
            const falseDiv = generateDiv(falseId, alternate.nodes, true);
            nodes.splice(i, 0, falseDiv);

            parseBlock(alternate.nodes);
          }
          break;

        case `Code`:
          const { val } = node;
          if (val.startsWith(`let `) && val.includes(`=`)) {
            const equals = val.indexOf(`=`);
      
            const name = val.substring(4, equals).trim();
            const value = val.substring(equals+1).trim();
            variables.push({name, value});

          } else {
            const boundId = randomId();
            const newDiv = generateDiv(boundId, [], false);

            nodes.splice(i, 1, newDiv);

            boundValues.push({id: boundId, expression: val, attr: `innerHTML`});

            // Then, we need to capture if this test contains any variables we know about
            // so we can easily trigger the event if this variable changes
            val.split(` `).forEach(w => {
              if (variables.some(v => v.name === w)) {
                if (!variableEvents[w]) variableEvents[w] = [];
    
                variableEvents[w].push(boundId);
              }
            })
          }
          break;

        default:
          if (node.attrs) {
            const existingIdAttr = node.attrs.find(a => a.name === `id`);
            const boundId = (existingIdAttr ? existingIdAttr.val : randomId());
            let hasToBind = false;
            
            for (const attr of node.attrs) {
              let doCurrentBind = false;
              const { name, val } = attr;
    
              // Then, we need to capture if this test contains any variables we know about
              // so we can easily trigger the event if this variable changes
              val.split(` `).forEach(w => {
                if (variables.some(v => v.name === w)) {
                  doCurrentBind = true;
                  if (!variableEvents[w]) variableEvents[w] = [];
      
                  variableEvents[w].push(boundId);
                }
              })

              if (doCurrentBind) {
                boundValues.push({id: boundId, attr: name, expression: val});
                hasToBind = true;
              }
            }

            if (hasToBind) {
              if (!existingIdAttr) {
                // Push new one
                node.attrs.push({
                  name: "id",
                  val: `'${boundId}'`,
                  mustEscape: false,
                });
              }
            }
          }

          if (node.block) {
            parseBlock(node.block.nodes);
          }
          break;
      }
    }
  }

  // Then we start parsing the code for logic
  parseBlock(ast.nodes);

  const fileScript = [
    ...variables.map(v => `let ${v.name} = undefined;`),
    
    ...variables.map(v => [
      `const set_${v.name} = (newValue) => {`,
      `  ${v.name} = newValue;`,
        (variableEvents[v.name] ? variableEvents[v.name].map(ev => `  event_${ev}()`).join(`\n`) : ` // No matching event found`),
      `}`
    ].join(`\n`)),

    ...conditionals.map(c => [
      `const event_${c.id} = () => {`,
      `  const ev = ${c.expression};`,
      ...c.when.map(when => `  document.getElementById("${when.id}").style.display = (ev === ${when.equals} ? '' : 'none');`),
      `}`
    ].join(`\n`)),

    ...boundValues.map(c => [
      `const event_${c.id} = () => {`,
      `  document.getElementById("${c.id}").${c.attr} = ${c.expression};`,
      `}`
    ].join(`\n`)),

    ``,
    `window.addEventListener('load', function () {`,
    ...variables.map(v => `set_${v.name}(${v.value});`),
    `});`,
  ]

  let code = generateCode(ast,  {
    compileDebug: false,
    pretty: true,
    inlineRuntimeFunctions: true,
    templateName: 'helloWorld'
  });

  var func = wrap(code, 'helloWorld');
  let result = func();

  result = [
    ``,
    `<script>`,
    fileScript.join(`\n`),
    `</script>`,
    ``
  ].join(`\n`) + result

  console.log(result);
  writeFileSync(`index.html`, result);
}