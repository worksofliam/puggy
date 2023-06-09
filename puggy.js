"use strict";

const parse = require('pug-parser');
const lex = require('pug-lexer');
const generateCode = require('pug-code-gen');
const wrap = require('pug-runtime/wrap');
const crypto = require("crypto");
const { readFileSync } = require('fs');
const path = require('path');

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

  parse(sourcePath) {
    this.ast = PuggyCompiler.getAst(sourcePath, this.name);

    if (this.ast.nodes && this.ast.nodes.length) {
      this._parseBlock(this.ast.nodes);

      let code = generateCode(this.ast, {
        compileDebug: false,
        pretty: true,
        inlineRuntimeFunctions: true,
        templateName: 'index'
      });
  
      var func = wrap(code, 'index');
      this.builtContent = func();

    } else {
      throw new Error(`No nodes to parse`);
    }
  }

  /**
   * Prepare for the biggest hack EVER.
   * This replaces local mix in calls to global component calls
   */
  _getComponentJs() {
    const componentNames = this.components.map(c => c.name);
    const globalComponents = this.components.map(c => c.getComponentFunc());

    for (let i = 0; i < globalComponents.length; i++) {
      componentNames.forEach(cn => {
        globalComponents[i] = globalComponents[i].replace(new RegExp(`pug\\_mixins\\["${cn}"\\]`, `g`), `pug_html += c_${cn}`);
      })
    }

    return globalComponents;
  }

  /**
   * @param {object} [variableDefaults] Optional variables for runtime 
   * @returns {string}
   */
  _getRuntimeJs(variableDefaults) {
    const script = [
      ...this.variables.map(v => `let ${v.name} = undefined;`),

      // Define the component
      ...this._getComponentJs(),

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
      `addEventListener("DOMContentLoaded", (event) => {`,
      // Set all variables when the page loads
      ...this.variables.map(v => `set_${v.name}(${variableDefaults && variableDefaults[v.name] ? (JSON.stringify(variableDefaults[v.name]) || v.value) : v.value});`),

      // Render all the components that don't have variable parameters
      ...this.componentDivs.filter(c => c.variableParm !== true).map(c => {
        return `event_${c.id}();`;
      }),
      `});`,
    ].join(`\n`)

    return script;
  }

  getComponentFunc() {
    let code = generateCode(this.ast, {
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

  /**
   * @param {object} [variableDefaults] Optional variables for runtime 
   * @returns {string}
   */
  getAsHtmlFile(variableDefaults) {
    if (!this.builtContent) throw new Error(`Code has not compiled.`);

    const result = [
      ``,
      `<script>`,
      this._getRuntimeJs(variableDefaults),
      `</script>`,
      ``
    ].join(`\n`) + this.builtContent;

    return result;
  }

  /**
  * @param {any[]} nodes 
  */
  _parseBlock(nodes, groupId) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      switch (node.type) {
        case `Each`:
          const { obj, val: expr, block: eachNodes } = node;

          const useParentAsDiv = groupId !== undefined && nodes.length === 1;

          // Create the div
          const eachId = useParentAsDiv ? trimQuotes(groupId) : PuggyCompiler.randomId();

          if (!useParentAsDiv) {
            const eachDiv = PuggyCompiler.generateDiv(eachId, [], false);
            nodes.splice(i, 1, eachDiv);
          }

          if (this.variables.some(v => v.name === obj)) {
            if (!this.variableEvents[obj]) this.variableEvents[obj] = [];
            this.variableEvents[obj].push(eachId);
          }

          // Create the each component
          const eachRuntime = new PuggyCompiler(`each_${eachId}`, "component");
          eachRuntime.variables = expr.split(`,`).map(v => ({ name: v.trim(), value: "undefined" }));
          eachRuntime.ast = eachNodes;
          this.components.push(eachRuntime);

          // Create the event for the each loop
          this.eachLoops.push({ id: eachId, array: obj, runtimeArgs: expr });
          break;

        case `Mixin`:
          const { name, args, block, call } = node;

          if (call) {
            const mixinResultId = PuggyCompiler.randomId();
            const mixinDiv = PuggyCompiler.generateDiv(mixinResultId, [], false);
            nodes.splice(i, 1, mixinDiv);

            let variableParm = false;

            PuggyCompiler.parseExpression(args).forEach(w => {
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
            mixinRuntime.variables = args.split(`,`).map(v => ({ name: v.trim(), value: "undefined" }));
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

          // Capture what makes this conditional part show
          const conditionEvent = PuggyCompiler.randomId();
          const currentCond = {
            id: conditionEvent,
            expression: test,
            when: [
              { equals: `true`, id: trueId },
            ]
          };

          // Then, we need to capture if this test contains any variables we know about
          // so we can easily trigger the event if this variable changes
          PuggyCompiler.parseExpression(test).forEach(w => {
            if (this.variables.some(v => v.name === w)) {
              if (!this.variableEvents[w]) this.variableEvents[w] = [];

              this.variableEvents[w].push(conditionEvent);
            }
          });

          const trueDiv = PuggyCompiler.generateDiv(trueId, consequent.nodes, true);
          nodes.splice(i, 1, trueDiv);

          this._parseBlock(consequent.nodes, conditionEvent);

          if (alternate) {
            const falseId = PuggyCompiler.randomId();
            const falseDiv = PuggyCompiler.generateDiv(falseId, alternate.nodes, true);
            nodes.splice(i, 0, falseDiv);

            this._parseBlock(alternate.nodes, conditionEvent);

            currentCond.when.push({equals: `false`, id: falseId});
          }

          this.conditionals.push(currentCond);
          break;

        case `Code`:
          const { val } = node;
          if (val.startsWith(`let `) && val.includes(`=`)) {
            const equals = val.indexOf(`=`);

            const name = val.substring(4, equals).trim();
            const value = val.substring(equals + 1).trim();
            this.variables.push({ name, value });

          } else {
            const boundId = PuggyCompiler.randomId();
            const newDiv = PuggyCompiler.generateDiv(boundId, [], false);

            nodes.splice(i, 1, newDiv);

            this.boundValues.push({ id: boundId, expression: val, attr: `innerHTML` });

            // Then, we need to capture if this test contains any variables we know about
            // so we can easily trigger the event if this variable changes
            PuggyCompiler.parseExpression(val).forEach(w => {
              if (this.variables.some(v => v.name === w)) {
                if (!this.variableEvents[w]) this.variableEvents[w] = [];

                this.variableEvents[w].push(boundId);
              }
            })
          }
          break;

        default:
          const existingIdAttr = node.attrs ? node.attrs.find(a => a.name === `id`) : undefined;
          if (node.attrs) {
            const boundId = (existingIdAttr ? existingIdAttr.val : PuggyCompiler.randomId());
            let hasToBind = false;

            for (const attr of node.attrs) {
              let doCurrentBind = false;
              const { name, val } = attr;

              // Then, we need to capture if this test contains any variables we know about
              // so we can easily trigger the event if this variable changes
              PuggyCompiler.parseExpression(val).forEach(w => {
                if (this.variables.some(v => v.name === w)) {
                  doCurrentBind = true;
                  if (!this.variableEvents[w]) this.variableEvents[w] = [];

                  this.variableEvents[w].push(boundId);
                }
              })

              if (doCurrentBind) {
                this.boundValues.push({ id: boundId, attr: name, expression: val });
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
            this._parseBlock(node.block.nodes, existingIdAttr ? existingIdAttr.val : undefined);
          }
          break;
      }
    }
  }

  static getAst(sourcePath, filename) {
    const source = readFileSync(sourcePath, {encoding: `utf-8`});
    var tokens = lex(source, { filename });
    var ast = parse(tokens, { filename, source });

    const resolveBlockIncludes = (nodes) => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.type === `Include`) {
          const { file } = node;
          const subAst = this.getAst(
            path.join(path.dirname(sourcePath), file.path), 
            path.basename(file.path)
          );
          if (subAst.nodes) {
            nodes.splice(i, 1, ...subAst.nodes)
            i = (i - 1) + subAst.nodes.length;
          }
        } else if (node.block) {
          resolveBlockIncludes(node.block.nodes)
        }
      }
    }

    resolveBlockIncludes(ast.nodes);

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
   * Parses an expression to get possible variables out
   */
  static parseExpression(expr) {
    let words = [];
    let inString = false;
    let currentWord = ``;

    for (const character of expr) {
      if ([`'`, `"`, `\``].includes(character)) {
        inString = !inString;
        currentWord += character;

        if (inString === false) {
          // We don't want strings really.
          // if (currentWord) words.push(currentWord);
          currentWord = ``;
        }

      } else {
        if (inString) {
          currentWord += character
        } else {
          if (/^[A-Za-z0-9]+$/.test(character)) {
            currentWord += character
          } else {
            if (currentWord) words.push(currentWord);
            currentWord = ``;
          }
        }
      }
    }

    if (currentWord) words.push(currentWord);
    return words;
  }
}

const trimQuotes = (input) => {
  if (input.startsWith(`'`)) input = input.substring(1);
  if (input.endsWith(`'`)) input = input.substring(0, input.length-1);
  return input;
}