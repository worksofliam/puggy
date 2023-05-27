"use strict";

const parse = require('pug-parser');
const lex = require('pug-lexer');
const generateCode = require('pug-code-gen');
const wrap = require('pug-runtime/wrap');
const crypto = require("crypto");

module.exports = class PuggyCompiler {
  /**
   * @param {"main"|"component"} type 
   */
  constructor(name, type = "main") {
    this.name = name;
    this.type = type;

    /** @type {{name: string, value: string}[]} */
    this.variables = [];

    /** We need to create the event for each loops
     * @type {{id: string, array: string, runtimeArgs: string}[]} */
    this.eachLoops = [];

    /** @type {PuggyCompiler[]} */
    this.components = [];
    
    /** Keeps track of what events need to be triggered when a variable changes
     * @type {{[name: string]: string[]}} */
    this.variableEvents = {}

    /** Conditions is used to determine which divs should be rendered based on an expression
     * @type {{id: string, expression: string, when: {equals: string, id: string}[]}[]} */
    this.conditionals = [];

    /** boundValues is used for updating an attribute of a node (like innerHTML, href, etc)
     * @type {{id: string, attr: string, expression: string}[]} */
    this.boundValues = [];

    /** When a component is reference, it has to be rendered after the page loads
     * @type {{id: string, runtimeArgs: string, component: string, variableParm?: boolean}[]} */
    this.componentDivs = [];

    this.ast = [];
  }

  parse(source) {
    this.ast = PuggyCompiler.getAst(source, this.name);

    if (this.ast.nodes && this.ast.nodes.length) {
      this.parseBlock(this.ast.nodes);
    } else {
      throw new Error(`No nodes to parse`);
    }
  }

  /**
   * Prepare for the biggest hack EVER.
   * This replaces local mix in calls to global component calls
   */
  getComponentJs() {
    const componentNames = this.components.map(c => c.name);
    const globalComponents = this.components.map(c => c.getComponentFunc());

    for (let i = 0; i < globalComponents.length; i++) {
      componentNames.forEach(cn => {
        globalComponents[i] = globalComponents[i].replace(new RegExp(`pug\\_mixins\\["${cn}"\\]`, `g`), `pug_html += c_${cn}`);
      })
    }

    return globalComponents;
  }

  getRuntimeJs() {
    const script = [
      ...this.variables.map(v => `let ${v.name} = undefined;`),

      // Define the component
      ...this.getComponentJs(),
      
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
  
      ...this.eachLoops.map(c => [
        `const event_${c.id} = () => {`,
        `  document.getElementById("${c.id}").innerHTML = ${c.array}.map(${c.runtimeArgs} => c_each_${c.id}(${c.runtimeArgs})).join('');`,
        `}`
      ].join(`\n`)),

      // Define the events that update component calls
      ...this.componentDivs.map(c => {
        return [
          `const event_${c.id} = () => {`,
          `  document.getElementById("${c.id}").innerHTML = c_${c.component}(${c.runtimeArgs});`,
          `}`
        ].join(`\n`);
      }),
  
      ``,
      `window.addEventListener('load', function () {`,
      // Set all variables when the page loads
      ...this.variables.map(v => `set_${v.name}(${v.value});`),
      
      // Render all the components that don't have variable parameters
      ...this.componentDivs.filter(c => c.variableParm !== true).map(c => {
        return `event_${c.id}();`;
      }),
      `});`,
    ].join(`\n`)

    return script;
  }

  getComponentFunc() {
    let code = generateCode(this.ast,  {
      compileDebug: false,
      pretty: true,
      inlineRuntimeFunctions: true,
      templateName: this.name
    });

    return [
      `const c_${this.name} = (${this.variables.map(v => v.name).join(`, `)}) => {`,
        code,
        `return ${this.name}({${this.variables.map(v => v.name).join(`, `)}})`,
      `};`
    ].join(`\n`)
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
        case `Each`: 
          const { obj, val: expr, block: eachNodes } = node;

          // Create the div
          const eachId = PuggyCompiler.randomId();
          const eachDiv = PuggyCompiler.generateDiv(eachId, [], false);
          nodes.splice(i, 1, eachDiv);

          if (this.variables.some(v => v.name === obj)) {
            if (!this.variableEvents[obj]) this.variableEvents[obj] = [];
            this.variableEvents[obj].push(eachId);
          }

          // Create the each component
          const eachRuntime = new PuggyCompiler(`each_${eachId}`, "component");
          eachRuntime.variables = expr.split(`,`).map(v => ({name: v.trim(), value: "undefined"}));
          eachRuntime.ast = eachNodes;
          this.components.push(eachRuntime);

          // Create the event for the each loop
          this.eachLoops.push({id: eachId, array: obj, runtimeArgs: expr});

          break;

        case `Mixin`:
          const { name, args, block, call } = node;

          if (call) {
            const mixinResultId = PuggyCompiler.randomId();
            const mixinDiv = PuggyCompiler.generateDiv(mixinResultId, [], false);
            nodes.splice(i, 1, mixinDiv);
            
            let variableParm = false;

            args.split(`,`).forEach(w => {
              w = w.trim();
              if (this.variables.some(v => v.name === w)) {
                variableParm = true;
                if (!this.variableEvents[w]) this.variableEvents[w] = [];

                this.variableEvents[w].push(mixinResultId);
              }
            });
            
            this.componentDivs.push({
              id: mixinResultId,
              runtimeArgs: args,
              component: name,
              variableParm
            });

          } else {
            const mixinRuntime = new PuggyCompiler(name, "component");
            mixinRuntime.variables = args.split(`,`).map(v => ({name: v.trim(), value: "undefined"}));
            mixinRuntime.ast = block;
            // Do not parse this!!!!
            // mixinRuntime.parseBlock(block.nodes);

            // Remove the mixin from the base
            nodes.splice(i, 1);
            i -= 1;

            this.components.push(mixinRuntime);
          }

          break;

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