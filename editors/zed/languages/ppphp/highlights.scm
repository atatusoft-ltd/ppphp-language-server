; Native PHP/++PHP syntax colors work without a language server.
(name) @variable
; Match the PHP extension's theme role for capitalized names (including imports).
((name) @constructor
  (#match? @constructor "^[A-Z]"))
(variable_name) @variable
(comment) @comment
[(string) (encapsed_string) (heredoc) (nowdoc)] @string
(escape_sequence) @string.escape
[(integer) (float)] @number
(boolean) @boolean
(null) @constant.builtin
(php_tag) @tag
(primitive_type) @type.builtin
(named_type (name) @constructor)
(namespace_name (name) @constructor)
(class_declaration name: (name) @constructor)
(interface_declaration name: (name) @constructor)
(trait_declaration name: (name) @constructor)
(enum_declaration name: (name) @constructor)
(function_definition name: (name) @function)
(method_declaration name: (name) @function)
(function_call_expression function: (name) @function)
(member_call_expression name: (name) @function)
(member_access_expression name: (name) @property)

[
  "abstract" "and" "as" "break" "case" "catch" "class" "clone" "const" "continue"
  "declare" "default" "do" "echo" "else" "elseif" "enddeclare"
  "endfor" "endforeach" "endif" "endswitch" "endwhile" "enum" "extends"
  "final" "finally" "fn" "for" "foreach" "function" "global" "goto" "if"
  "implements" "include" "include_once" "instanceof" "insteadof" "interface"
  "list" "match" "namespace" "new" "or" "print" "private" "protected"
  "public" "readonly" "require" "require_once" "return" "static" "switch"
  "throw" "trait" "try" "unset" "use" "while" "xor" "yield" "yield from"
] @keyword

[
  "=" "+" "-" "*" "/" "%" "**" "." "==" "===" "!=" "!==" "<" ">"
  "<=" ">=" "<=>" "&&" "||" "!" "&" "|" "^" "~" "<<" ">>"
  "$" "++" "--" "+=" "-=" "*=" "/=" ".=" "??" "??=" "=>" "->" "?->" "::"
] @operator
["(" ")" "[" "]" "{" "}"] @punctuation.bracket
[";" "," ":" "\\"] @punctuation.delimiter

; ++PHP types and generic delimiters are structural, not comparison operators.
(type_parameter name: (name) @constructor)
; Fully qualified type annotations retain PHP's cyan type role.
(named_type (qualified_name) @type)
(named_type (qualified_name (namespace_name (name) @type)))
(named_type (qualified_name (name) @type))
(object_creation_expression (name) @constructor)
["throws" "when"] @keyword
(type_arguments "<" @punctuation.bracket ">" @punctuation.bracket)
(type_parameters "<" @punctuation.bracket ">" @punctuation.bracket)
