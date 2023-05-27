const parse = require('pug-parser');
const lex = require('pug-lexer');
const generateCode = require('pug-code-gen');
const wrap = require('pug-runtime/wrap');
const crypto = require("crypto");

module.exports = class PuggyCompiler {
  constructor() {
    /** @type {{name: string, value: string}[]} */
    this.variables = [];

    /** @type {{id: string, expression: string, when: {equals: string, id: string}[]}[]} */
    this.conditionals = [];

    /** @type {{id: string, attr: string, expression: string}[]} */
    this.boundValues = [];
    
    /** @type {{[name: string]: string[]}} */
    this.variableEvents = {}

    this.ast = [];
  }

  parse(source, filename = `index.pug`) {
    this.ast = PuggyCompiler.getAst(source, filename);

    if (this.ast.nodes && this.ast.nodes.length) {
      this.parseBlock(this.ast.nodes);
    } else {
      throw new Error(`No nodes to parse`);
    }
  }

  getRuntimeJs() {
    const script = [
      ...this.variables.map(v => `let ${v.name} = undefined;`),
      
      ...this.variables.map(v => [
        `const set_${v.name} = (newValue) => {`,
        `  ${v.name} = newValue;`,
          (this.variableEvents[v.name] ? this.variableEvents[v.name].map(ev => `  event_${ev}()`).join(`\n`) : ` // No matching event found`),
        `}`
      ].join(`\n`)),
  
      ...this.conditionals.map(c => [
        `const event_${c.id} = () => {`,
        `  const ev = ${c.expression};`,
        ...c.when.map(when => `  document.getElementById("${when.id}").style.display = (ev === ${when.equals} ? '' : 'none');`),
        `}`
      ].join(`\n`)),
  
      ...this.boundValues.map(c => [
        `const event_${c.id} = () => {`,
        `  document.getElementById("${c.id}").${c.attr} = ${c.expression};`,
        `}`
      ].join(`\n`)),
  
      ``,
      `window.addEventListener('load', function () {`,
      ...this.variables.map(v => `set_${v.name}(${v.value});`),
      `});`,
    ].join(`\n`)

    return script;
  }

  getAsHtmlFile() {
    let code = generateCode(this.ast,  {
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
      this.getRuntimeJs(),
      `</script>`,
      ``
    ].join(`\n`) + result
  
    return result;
  }

  static getAst(source, filename) {
    var tokens = lex(source, {filename});
    var ast = parse(tokens, {filename, source});
    return ast;
  }

  static generateDiv(id, nodes, hidden = false) {
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

  static randomId() {
    return crypto.randomBytes(8).toString("hex");
  }

  /**
  * @param {any[]} nodes 
  */
  parseBlock(nodes) {
   for (let i = 0; i < nodes.length; i++) {
     const node = nodes[i];

     switch (node.type) {
       case `Conditional`:
         const { test, consequent, alternate } = node;

         const trueId = PuggyCompiler.randomId();
         const falseId = PuggyCompiler.randomId();
 
         // Capture what makes this conditional part show
         const conditionEvent = PuggyCompiler.randomId();
         this.conditionals.push({
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
           if (this.variables.some(v => v.name === w)) {
             if (!this.variableEvents[w]) this.variableEvents[w] = [];
 
             this.variableEvents[w].push(conditionEvent);
           }
         });
 
         const trueDiv = PuggyCompiler.generateDiv(trueId, consequent.nodes, true);
         nodes.splice(i, 1, trueDiv);

         this.parseBlock(consequent.nodes);
 
         if (alternate) {
           const falseDiv = PuggyCompiler.generateDiv(falseId, alternate.nodes, true);
           nodes.splice(i, 0, falseDiv);

           this.parseBlock(alternate.nodes);
         }
         break;

       case `Code`:
         const { val } = node;
         if (val.startsWith(`let `) && val.includes(`=`)) {
           const equals = val.indexOf(`=`);
     
           const name = val.substring(4, equals).trim();
           const value = val.substring(equals+1).trim();
           this.variables.push({name, value});

         } else {
           const boundId = PuggyCompiler.randomId();
           const newDiv = PuggyCompiler.generateDiv(boundId, [], false);

           nodes.splice(i, 1, newDiv);

           this.boundValues.push({id: boundId, expression: val, attr: `innerHTML`});

           // Then, we need to capture if this test contains any variables we know about
           // so we can easily trigger the event if this variable changes
           val.split(` `).forEach(w => {
             if (this.variables.some(v => v.name === w)) {
               if (!this.variableEvents[w]) this.variableEvents[w] = [];
   
               this.variableEvents[w].push(boundId);
             }
           })
         }
         break;

       default:
         if (node.attrs) {
           const existingIdAttr = node.attrs.find(a => a.name === `id`);
           const boundId = (existingIdAttr ? existingIdAttr.val : PuggyCompiler.randomId());
           let hasToBind = false;
           
           for (const attr of node.attrs) {
             let doCurrentBind = false;
             const { name, val } = attr;
   
             // Then, we need to capture if this test contains any variables we know about
             // so we can easily trigger the event if this variable changes
             val.split(` `).forEach(w => {
               if (this.variables.some(v => v.name === w)) {
                 doCurrentBind = true;
                 if (!this.variableEvents[w]) this.variableEvents[w] = [];
     
                 this.variableEvents[w].push(boundId);
               }
             })

             if (doCurrentBind) {
               this.boundValues.push({id: boundId, attr: name, expression: val});
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
           this.parseBlock(node.block.nodes);
         }
         break;
     }
   }
 }
}