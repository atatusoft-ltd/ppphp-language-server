use std::collections::HashSet;
use tree_sitter::{Parser, Query, QueryCursor, StreamingIterator};

const QUERIES: &[(&str, &str)] = &[
    (
        "highlights",
        include_str!("../languages/ppphp/highlights.scm"),
    ),
    ("brackets", include_str!("../languages/ppphp/brackets.scm")),
    ("indents", include_str!("../languages/ppphp/indents.scm")),
    ("outline", include_str!("../languages/ppphp/outline.scm")),
    (
        "overrides",
        include_str!("../languages/ppphp/overrides.scm"),
    ),
    (
        "textobjects",
        include_str!("../languages/ppphp/textobjects.scm"),
    ),
];

fn captures(query: &str, source: &str) -> HashSet<(String, String)> {
    let language = tree_sitter_ppphp::LANGUAGE.into();
    let query = Query::new(&language, query).expect("valid query for the pinned grammar");
    let mut parser = Parser::new();
    parser.set_language(&language).unwrap();
    let tree = parser.parse(source, None).unwrap();
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(&query, tree.root_node(), source.as_bytes());
    let mut result = HashSet::new();
    while let Some(matched) = matches.next() {
        for capture in matched.captures {
            result.insert((
                query.capture_names()[capture.index as usize].to_string(),
                capture
                    .node
                    .utf8_text(source.as_bytes())
                    .unwrap()
                    .to_string(),
            ));
        }
    }
    result
}

#[test]
fn every_query_compiles_and_runs_on_the_shared_ppphp_fixture() {
    let source = include_str!("../../fixtures/recognized-syntax.ppphp");
    for (name, query) in QUERIES {
        assert!(
            !captures(query, source).is_empty(),
            "no captures from {name}"
        );
    }
}

#[test]
fn lexical_highlights_and_outline_survive_ppphp_syntax() {
    let source = include_str!("../../fixtures/recognized-syntax.ppphp");
    let highlights = captures(QUERIES[0].1, source);
    for (kind, text) in [
        ("tag", "<?php"),
        ("keyword", "namespace"),
        ("variable", "$requestedId"),
        ("string", "'cached'"),
    ] {
        assert!(
            highlights.contains(&(kind.into(), text.into())),
            "missing {kind}: {text}"
        );
    }
    let outline = captures(
        QUERIES[3].1,
        "<?php\nnamespace Demo;\nclass Person { function name(): string { return 'name'; } }",
    );
    for name in ["Demo", "Person", "name"] {
        assert!(outline.contains(&("name".into(), name.into())));
    }
    let overrides = captures(QUERIES[4].1, "<?php\n// example\n$label = 'hello';");
    assert!(overrides.contains(&("comment.inclusive".into(), "// example".into())));
    assert!(overrides.contains(&("string".into(), "'hello'".into())));
}

#[test]
fn generic_types_and_typed_locals_have_native_highlights_without_lsp() {
    let source = include_str!("../../fixtures/generic-types.ppphp");
    let language = tree_sitter_ppphp::LANGUAGE.into();
    let mut parser = Parser::new();
    parser.set_language(&language).unwrap();
    for fixture in [
        source,
        include_str!("../../fixtures/recognized-syntax.ppphp"),
    ] {
        let tree = parser.parse(fixture, None).unwrap();
        assert!(
            !tree.root_node().has_error(),
            "++PHP syntax must not rely on PHP parser recovery: {}",
            tree.root_node().to_sexp()
        );
    }

    let highlights = captures(QUERIES[0].1, source);
    for (kind, text) in [
        ("constructor", "Box"),
        ("constructor", "T"),
        ("constructor", "U"),
        ("constructor", "Model"),
        ("constructor", "Product"),
        ("type.builtin", "array"),
        ("type.builtin", "string"),
        ("punctuation.bracket", "<"),
        ("punctuation.bracket", ">"),
        ("keyword", "throws"),
        ("keyword", "readonly"),
    ] {
        assert!(
            highlights.contains(&(kind.into(), text.into())),
            "missing {kind}: {text}"
        );
    }
    assert!(!highlights.contains(&("constructor".into(), "NotAType".into())));

    // Generic angle brackets participate in matching; comparison and shift
    // operators in the same document must remain ordinary operators.
    let tree = parser.parse(source, None).unwrap();
    let query = Query::new(&language, QUERIES[1].1).unwrap();
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(&query, tree.root_node(), source.as_bytes());
    let comparison = source.find("$left < $right").unwrap() + "$left ".len();
    let shift = source.find("$left >> 1").unwrap() + "$left ".len();
    while let Some(matched) = matches.next() {
        for capture in matched.captures {
            assert_ne!(capture.node.start_byte(), comparison);
            assert_ne!(capture.node.start_byte(), shift);
        }
    }
}

#[test]
fn named_types_use_the_same_theme_role_as_php() {
    let source = "<?php\nnamespace Acme\\Demo;\nuse Acme\\Domain\\Product;\nclass Catalog {\n  function load(Product $item): array { array<string, Product> $items = []; return $items; }\n}\n";
    let highlights = captures(QUERIES[0].1, source);
    for name in ["Acme", "Demo", "Domain", "Product", "Catalog"] {
        assert!(highlights.contains(&("constructor".into(), name.into())));
        assert!(!highlights.contains(&("type".into(), name.into())));
    }
    for builtin in ["array", "string"] {
        assert!(highlights.contains(&("type.builtin".into(), builtin.into())));
    }
    let rules: zed_extension_api::serde_json::Value = zed_extension_api::serde_json::from_str(
        include_str!("../languages/ppphp/semantic_token_rules.json"),
    )
    .unwrap();
    for role in [
        "namespace",
        "class",
        "interface",
        "enum",
        "typeParameter",
        "type",
    ] {
        let rule = rules
            .as_array()
            .unwrap()
            .iter()
            .find(|rule| rule["token_type"] == role && rule.get("token_modifiers").is_none())
            .unwrap();
        assert_eq!(rule["style"][0], "constructor");
    }
}

#[test]
fn fully_qualified_types_and_variable_sigils_keep_php_type_and_operator_roles() {
    let source = "<?php\nfunction load(string $sku, \\Vendor\\Domain\\Product $item): \\Vendor\\Domain\\Product { return $item; }\n";
    let highlights = captures(QUERIES[0].1, source);
    for name in ["Vendor", "Domain", "Product", "\\Vendor\\Domain\\Product"] {
        assert!(highlights.contains(&("type".into(), name.into())));
    }
    assert!(highlights.contains(&("operator".into(), "$".into())));
    assert!(highlights.contains(&("type.builtin".into(), "string".into())));
    assert!(!highlights
        .iter()
        .any(|(role, _)| role == "variable.parameter"));
}

#[test]
fn php_word_operators_have_native_highlights_without_semantic_tokens() {
    let source = "<?php\n$result = $a and $b or $c xor $d;\n$result = $a AND $b OR $c XOR $d;\n";
    let highlights = captures(QUERIES[0].1, source);
    for operator in ["and", "or", "xor", "AND", "OR", "XOR"] {
        assert!(highlights.contains(&("keyword".into(), operator.into())));
    }
}

#[test]
fn ordinary_php_constructs_keep_parsing_with_the_ppphp_grammar() {
    let language = tree_sitter_ppphp::LANGUAGE.into();
    let mut parser = Parser::new();
    parser.set_language(&language).unwrap();
    let source = "<?php\n$items = array('one', 'two');\n$copy = (array) $items;\nif ($a < $b && $b > $c) { echo $a >> 1; }\nfunction greet(string $name): string { return \"Hello {$name}\"; }\n";
    assert!(!parser.parse(source, None).unwrap().root_node().has_error());
}
#[test]
fn manifest_and_language_configuration_register_only_ppphp() {
    let manifest: toml::Value = toml::from_str(include_str!("../extension.toml")).unwrap();
    let config: toml::Value =
        toml::from_str(include_str!("../languages/ppphp/config.toml")).unwrap();
    let cargo: toml::Value = toml::from_str(include_str!("../Cargo.toml")).unwrap();
    assert_eq!(config["name"].as_str(), Some("++PHP"));
    assert_eq!(
        config["path_suffixes"].as_array().unwrap(),
        &[toml::Value::String("ppphp".into())]
    );
    assert!(config.get("first_line_pattern").is_none());
    let server = &manifest["language_servers"]["ppphp-ls"];
    assert_eq!(
        server["languages"].as_array().unwrap(),
        &[config["name"].clone()]
    );
    assert_eq!(server["language_ids"]["++PHP"].as_str(), Some("ppphp"));
    let grammar = &manifest["grammars"][config["grammar"].as_str().unwrap()];
    assert_eq!(grammar["path"].as_str(), Some("grammars/ppphp"));
    assert_eq!(
        grammar["rev"],
        cargo["dev-dependencies"]["tree-sitter-ppphp"]["rev"]
    );
    assert_eq!(
        grammar["repository"],
        cargo["dev-dependencies"]["tree-sitter-ppphp"]["git"]
    );
    let version = include_str!("../../../VERSION").trim();
    assert_eq!(manifest["version"].as_str(), Some(version));
    assert_eq!(cargo["package"]["version"].as_str(), Some(version));
}

#[test]
fn semantic_token_rules_cover_the_server_legend() {
    let rules: zed_extension_api::serde_json::Value = zed_extension_api::serde_json::from_str(
        include_str!("../languages/ppphp/semantic_token_rules.json"),
    )
    .unwrap();
    let server = include_str!("../../../packages/language-server/src/semantic-tokens.ts");
    let legend = server
        .split("export const SEMANTIC_TOKEN_TYPES = [")
        .nth(1)
        .unwrap()
        .split("] as const")
        .next()
        .unwrap();
    for token_type in legend.lines().filter_map(|line| {
        line.trim()
            .strip_prefix('"')
            .and_then(|line| line.strip_suffix("\","))
    }) {
        assert!(
            rules
                .as_array()
                .unwrap()
                .iter()
                .any(|rule| rule["token_type"] == token_type
                    && rule.get("token_modifiers").is_none()),
            "missing rule for {token_type}"
        );
    }
}
