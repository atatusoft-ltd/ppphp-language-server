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
    let language = tree_sitter_php::LANGUAGE_PHP.into();
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
    assert_eq!(grammar["path"].as_str(), Some("php"));
    assert_eq!(
        grammar["rev"],
        cargo["dev-dependencies"]["tree-sitter-php"]["rev"]
    );
    assert_eq!(
        grammar["repository"],
        cargo["dev-dependencies"]["tree-sitter-php"]["git"]
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
