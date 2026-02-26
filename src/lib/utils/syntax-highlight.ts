// Simple syntax highlighting for code preview
// Provides basic highlighting without external dependencies

type TokenType = 'keyword' | 'string' | 'comment' | 'number' | 'function' | 'operator' | 'property' | 'tag' | 'attribute' | 'text';

interface Token {
  type: TokenType;
  value: string;
}

// Common keywords for JS/TS
const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw',
  'class', 'extends', 'new', 'this', 'super', 'import', 'export', 'from', 'as',
  'default', 'async', 'await', 'yield', 'typeof', 'instanceof', 'in', 'of',
  'true', 'false', 'null', 'undefined', 'void', 'delete', 'static', 'get', 'set',
]);

// HTML tags for HTML highlighting
const HTML_TAGS = new Set([
  'html', 'head', 'body', 'div', 'span', 'p', 'a', 'img', 'button', 'input',
  'form', 'label', 'select', 'option', 'textarea', 'table', 'tr', 'td', 'th',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'footer',
  'nav', 'main', 'section', 'article', 'aside', 'script', 'style', 'link',
  'meta', 'title', 'br', 'hr', 'pre', 'code', 'strong', 'em', 'i', 'b',
]);

// Detect language from file extension
export function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'html': 'html',
    'htm': 'html',
    'css': 'css',
    'json': 'json',
    'md': 'markdown',
    'py': 'python',
  };
  return langMap[ext] || 'text';
}

// Tokenize JavaScript/TypeScript
function tokenizeJS(code: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < code.length) {
    // Skip whitespace but preserve it
    if (/\s/.test(code[i])) {
      let ws = '';
      while (i < code.length && /\s/.test(code[i])) {
        ws += code[i++];
      }
      tokens.push({ type: 'text', value: ws });
      continue;
    }

    // Comments
    if (code.slice(i, i + 2) === '//') {
      let comment = '';
      while (i < code.length && code[i] !== '\n') {
        comment += code[i++];
      }
      tokens.push({ type: 'comment', value: comment });
      continue;
    }
    if (code.slice(i, i + 2) === '/*') {
      let comment = '';
      while (i < code.length && code.slice(i, i + 2) !== '*/') {
        comment += code[i++];
      }
      comment += code.slice(i, i + 2);
      i += 2;
      tokens.push({ type: 'comment', value: comment });
      continue;
    }

    // Strings
    if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const quote = code[i];
      let str = quote;
      i++;
      while (i < code.length && code[i] !== quote) {
        if (code[i] === '\\' && i + 1 < code.length) {
          str += code[i++];
        }
        str += code[i++];
      }
      if (i < code.length) str += code[i++];
      tokens.push({ type: 'string', value: str });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(code[i])) {
      let num = '';
      while (i < code.length && /[0-9.xXa-fA-F]/.test(code[i])) {
        num += code[i++];
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_$]/.test(code[i])) {
      let ident = '';
      while (i < code.length && /[a-zA-Z0-9_$]/.test(code[i])) {
        ident += code[i++];
      }
      // Check if it's followed by ( for function detection
      const isFunction = code[i] === '(' && !JS_KEYWORDS.has(ident);
      if (JS_KEYWORDS.has(ident)) {
        tokens.push({ type: 'keyword', value: ident });
      } else if (isFunction) {
        tokens.push({ type: 'function', value: ident });
      } else {
        tokens.push({ type: 'text', value: ident });
      }
      continue;
    }

    // Operators
    if (/[+\-*/%=<>!&|^~?:]/.test(code[i])) {
      let op = code[i++];
      while (i < code.length && /[+\-*/%=<>!&|^~?:]/.test(code[i])) {
        op += code[i++];
      }
      tokens.push({ type: 'operator', value: op });
      continue;
    }

    // Default: single character
    tokens.push({ type: 'text', value: code[i++] });
  }

  return tokens;
}

// Tokenize HTML
function tokenizeHTML(code: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < code.length) {
    // HTML comment
    if (code.slice(i, i + 4) === '<!--') {
      let comment = '';
      while (i < code.length && code.slice(i, i + 3) !== '-->') {
        comment += code[i++];
      }
      comment += code.slice(i, i + 3);
      i += 3;
      tokens.push({ type: 'comment', value: comment });
      continue;
    }

    // HTML tag
    if (code[i] === '<') {
      let tag = '<';
      i++;

      // Closing tag slash
      if (code[i] === '/') {
        tag += code[i++];
      }

      // Tag name
      let tagName = '';
      while (i < code.length && /[a-zA-Z0-9-]/.test(code[i])) {
        tagName += code[i++];
      }

      if (HTML_TAGS.has(tagName.toLowerCase()) || tagName.startsWith('!')) {
        tokens.push({ type: 'text', value: '<' + (tag.includes('/') ? '/' : '') });
        tokens.push({ type: 'tag', value: tagName });
      } else {
        tag += tagName;
        tokens.push({ type: 'text', value: tag });
        continue;
      }

      // Attributes and closing
      while (i < code.length && code[i] !== '>') {
        // Whitespace
        if (/\s/.test(code[i])) {
          let ws = '';
          while (i < code.length && /\s/.test(code[i])) {
            ws += code[i++];
          }
          tokens.push({ type: 'text', value: ws });
          continue;
        }

        // Attribute name
        if (/[a-zA-Z_-]/.test(code[i])) {
          let attr = '';
          while (i < code.length && /[a-zA-Z0-9_-]/.test(code[i])) {
            attr += code[i++];
          }
          tokens.push({ type: 'attribute', value: attr });
          continue;
        }

        // = sign
        if (code[i] === '=') {
          tokens.push({ type: 'operator', value: '=' });
          i++;
          continue;
        }

        // Attribute value
        if (code[i] === '"' || code[i] === "'") {
          const quote = code[i];
          let val = quote;
          i++;
          while (i < code.length && code[i] !== quote) {
            val += code[i++];
          }
          if (i < code.length) val += code[i++];
          tokens.push({ type: 'string', value: val });
          continue;
        }

        // Self-closing slash
        if (code[i] === '/') {
          tokens.push({ type: 'text', value: code[i++] });
          continue;
        }

        tokens.push({ type: 'text', value: code[i++] });
      }

      if (i < code.length && code[i] === '>') {
        tokens.push({ type: 'text', value: '>' });
        i++;
      }
      continue;
    }

    // Text content
    let text = '';
    while (i < code.length && code[i] !== '<') {
      text += code[i++];
    }
    if (text) {
      tokens.push({ type: 'text', value: text });
    }
  }

  return tokens;
}

// Tokenize CSS
function tokenizeCSS(code: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < code.length) {
    // Comments
    if (code.slice(i, i + 2) === '/*') {
      let comment = '';
      while (i < code.length && code.slice(i, i + 2) !== '*/') {
        comment += code[i++];
      }
      comment += code.slice(i, i + 2);
      i += 2;
      tokens.push({ type: 'comment', value: comment });
      continue;
    }

    // Strings
    if (code[i] === '"' || code[i] === "'") {
      const quote = code[i];
      let str = quote;
      i++;
      while (i < code.length && code[i] !== quote) {
        str += code[i++];
      }
      if (i < code.length) str += code[i++];
      tokens.push({ type: 'string', value: str });
      continue;
    }

    // Selector or property (simplified)
    if (/[a-zA-Z.#@-]/.test(code[i])) {
      let ident = '';
      while (i < code.length && /[a-zA-Z0-9_.\-#@]/.test(code[i])) {
        ident += code[i++];
      }
      // Check if it's a selector or property
      const isSelector = ident.startsWith('.') || ident.startsWith('#') || ident.startsWith('@');
      tokens.push({ type: isSelector ? 'tag' : 'property', value: ident });
      continue;
    }

    // Numbers with units
    if (/[0-9]/.test(code[i])) {
      let num = '';
      while (i < code.length && /[0-9.%a-zA-Z]/.test(code[i])) {
        num += code[i++];
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Default
    tokens.push({ type: 'text', value: code[i++] });
  }

  return tokens;
}

// Get CSS class for token type
function getTokenClass(type: TokenType): string {
  const classes: Record<TokenType, string> = {
    keyword: 'text-purple-600 dark:text-purple-400',
    string: 'text-green-600 dark:text-green-400',
    comment: 'text-zinc-400 dark:text-zinc-500 italic',
    number: 'text-orange-600 dark:text-orange-400',
    function: 'text-blue-600 dark:text-blue-400',
    operator: 'text-zinc-500 dark:text-zinc-400',
    property: 'text-cyan-600 dark:text-cyan-400',
    tag: 'text-red-600 dark:text-red-400',
    attribute: 'text-yellow-600 dark:text-yellow-400',
    text: '',
  };
  return classes[type];
}

// Main highlight function - returns array of {text, className} for rendering
export interface HighlightedSegment {
  text: string;
  className: string;
}

export function highlightCode(code: string, filename: string): HighlightedSegment[] {
  const language = detectLanguage(filename);

  let tokens: Token[];
  switch (language) {
    case 'javascript':
    case 'typescript':
    case 'json':
      tokens = tokenizeJS(code);
      break;
    case 'html':
      tokens = tokenizeHTML(code);
      break;
    case 'css':
      tokens = tokenizeCSS(code);
      break;
    default:
      // No highlighting for unknown languages
      return [{ text: code, className: '' }];
  }

  return tokens.map(token => ({
    text: token.value,
    className: getTokenClass(token.type),
  }));
}
