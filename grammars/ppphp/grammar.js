// ++PHP grammar built on the MIT-licensed PHP grammar vendored at the revision
// recorded in UPSTREAM. The inherited PHP rules keep ordinary PHP syntax intact.
const php = require("./vendor/define-grammar.js")("php");

function keyword(word) {
  return alias(new RegExp(word, "i"), word);
}

function commaSep1(rule) {
  return seq(rule, repeat(seq(",", rule)));
}

// Preserve all upstream declaration fields, including attributes and modifiers.
function insertAfterName(rule, extra) {
  if (rule.members) {
    return {
      ...rule,
      members: rule.members.flatMap((member) =>
        member.type === "FIELD" && member.name === "name"
          ? [member, optional(extra)]
          : [insertAfterName(member, extra)],
      ),
    };
  }
  return rule.content ? { ...rule, content: insertAfterName(rule.content, extra) } : rule;
}
function withThrows(rule, extra) {
  if (rule.type === "SEQ") {
    const members = [...rule.members];
    // The last member is the body or the method body/semicolon choice.
    members.splice(members.length - 1, 0, optional(extra));
    return { ...rule, members };
  }
  return { ...rule, content: withThrows(rule.content, extra) };
}

module.exports = grammar(php, {
  name: "ppphp",
  conflicts: ($, original) => [
    ...original,
    [$.named_type, $.primary_expression],
    [$.primitive_type, $.cast_type],
  ],
  rules: {
    primitive_type: ($, original) => choice(original, keyword("array")),
    _types: ($, original) => choice(original, $.generic_type),
    optional_type: ($) => seq("?", choice($.named_type, $.primitive_type, $.generic_type)),
    generic_type: ($) =>
      prec.dynamic(2, seq(field("name", choice($.named_type, $.primitive_type)), $.type_arguments)),
    type_arguments: ($) => seq("<", commaSep1($.type), ">"),
    type_parameters: ($) => seq("<", commaSep1($.type_parameter), ">"),
    type_parameter: ($) => seq(field("name", $.name), optional(seq(":", field("bound", $.type)))),

    class_declaration: ($, original) => insertAfterName(original, $.type_parameters),
    interface_declaration: ($, original) => insertAfterName(original, $.type_parameters),
    trait_declaration: ($, original) => insertAfterName(original, $.type_parameters),
    function_definition: ($, original) =>
      withThrows(insertAfterName(original, $.type_parameters), $.throws_clause),
    method_declaration: ($, original) =>
      withThrows(insertAfterName(original, $.type_parameters), $.throws_clause),
    throws_clause: ($) => seq(keyword("throws"), commaSep1($.type)),
    base_clause: ($) => seq(keyword("extends"), commaSep1(choice($._name, $.generic_type))),
    class_interface_clause: ($) =>
      seq(keyword("implements"), commaSep1(choice($._name, $.generic_type))),

    statement: ($, original) => choice(original, $.typed_variable_statement),
    typed_binding: ($) =>
      seq(optional($.readonly_modifier), field("type", $.type), field("name", $.variable_name)),
    typed_variable_declaration: ($) => seq($.typed_binding, "=", field("value", $.expression)),
    typed_variable_statement: ($) => seq($.typed_variable_declaration, $._semicolon),
    for_statement: ($, original) => {
      const members = [...original.members];
      members[2] = field(
        "initialize",
        optional(choice($._expressions, $.typed_variable_declaration)),
      );
      return { ...original, members };
    },
    foreach_pair: ($) => seq(choice($.expression, $.typed_binding), "=>", $._foreach_value),
    _foreach_value: ($, original) => choice(original, $.typed_binding),

    primary_expression: ($, original) => choice(original, $.when_expression),
    when_expression: ($) =>
      prec.right(
        seq(
          alias(token(prec(1, /when/i)), "when"),
          field("condition", $.parenthesized_expression),
          field("body", $.compound_statement),
          repeat(
            seq(
              keyword("else"),
              alias(token(prec(1, /when/i)), "when"),
              field("condition", $.parenthesized_expression),
              field("body", $.compound_statement),
            ),
          ),
          optional(seq(keyword("else"), field("alternative", $.compound_statement))),
        ),
      ),
  },
});
