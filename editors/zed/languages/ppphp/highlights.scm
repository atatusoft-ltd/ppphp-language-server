; Native PHP/++PHP syntax colors work without a language server.
(name) @variable
(variable_name) @variable
(comment) @comment
[(string) (encapsed_string) (heredoc) (nowdoc)] @string
(escape_sequence) @string.escape
[(integer) (float)] @number
(boolean) @boolean
(null) @constant.builtin
(php_tag) @tag
(primitive_type) @type.builtin
(named_type (name) @type)
(namespace_name (name) @type)
(class_declaration name: (name) @type)
(interface_declaration name: (name) @type)
(trait_declaration name: (name) @type)
(enum_declaration name: (name) @type)
(function_definition name: (name) @function)
(method_declaration name: (name) @function)
(function_call_expression function: (name) @function)
(member_call_expression name: (name) @function)
(member_access_expression name: (name) @property)
(simple_parameter name: (variable_name) @variable.parameter)

[
  "abstract" "as" "break" "case" "catch" "class" "clone" "const" "continue"
  "declare" "default" "do" "echo" "else" "elseif" "enddeclare"
  "endfor" "endforeach" "endif" "endswitch" "endwhile" "enum" "extends"
  "final" "finally" "fn" "for" "foreach" "function" "global" "goto" "if"
  "implements" "include" "include_once" "instanceof" "insteadof" "interface"
  "list" "match" "namespace" "new" "print" "private" "protected"
  "public" "readonly" "require" "require_once" "return" "static" "switch"
  "throw" "trait" "try" "unset" "use" "while" "yield" "yield from"
] @keyword

[
  "=" "+" "-" "*" "/" "%" "**" "." "==" "===" "!=" "!==" "<" ">"
  "<=" ">=" "<=>" "&&" "||" "!" "&" "|" "^" "~" "<<" ">>"
  "++" "--" "+=" "-=" "*=" "/=" ".=" "??" "??=" "=>" "->" "?->" "::"
] @operator
["(" ")" "[" "]" "{" "}"] @punctuation.bracket
[";" "," ":" "\\"] @punctuation.delimiter

; ++PHP types and generic delimiters are structural, not comparison operators.
(type_parameter name: (name) @type)
(named_type (qualified_name (name) @type))
(object_creation_expression (name) @type)
["throws" "when"] @keyword
(type_arguments "<" @punctuation.bracket ">" @punctuation.bracket)
(type_parameters "<" @punctuation.bracket ">" @punctuation.bracket)
