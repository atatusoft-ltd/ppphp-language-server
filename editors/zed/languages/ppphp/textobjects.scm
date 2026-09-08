(function_definition body: (compound_statement) @function.inside) @function.around
(method_declaration body: (compound_statement) @function.inside) @function.around
(class_declaration body: (declaration_list) @class.inside) @class.around
(interface_declaration body: (declaration_list) @class.inside) @class.around
(trait_declaration body: (declaration_list) @class.inside) @class.around
(enum_declaration body: (enum_declaration_list) @class.inside) @class.around
(comment)+ @comment.around
