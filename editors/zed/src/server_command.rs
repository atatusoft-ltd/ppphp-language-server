use zed_extension_api::{settings::CommandSettings, Command, Result};

const BUNDLES: &[&str] = &[
    "node_modules/@ppphp/language-server/dist/server.cjs",
    "packages/language-server/dist/server.cjs",
];

/// Keep discovery worktree-local: a cached path from another project or host is unsafe.
pub(crate) fn resolve(
    binary: Option<CommandSettings>,
    root: &str,
    mut readable: impl FnMut(&str) -> bool,
    mut which: impl FnMut(&str) -> Option<String>,
    shell_env: impl FnOnce() -> Vec<(String, String)>,
) -> Result<Command> {
    let mut arguments = None;
    let mut extra_env = None;
    if let Some(binary) = binary {
        arguments = binary.arguments;
        extra_env = binary.env;
        if let Some(path) = binary.path {
            if path.trim().is_empty() {
                return Err("lsp.ppphp-ls.binary.path must not be empty".into());
            }
            return Ok(Command {
                command: which(&path).unwrap_or(path),
                args: arguments.unwrap_or_else(|| vec!["--stdio".into()]),
                env: merge_env(shell_env(), extra_env),
            });
        }
    }

    for relative_path in BUNDLES {
        if readable(relative_path) {
            // Resolve Node on the worktree host, including remote/WSL projects.
            let node = which("node").ok_or(
                "++PHP needs Node.js on the project host's PATH to run server.cjs. \
                 Install the runtime required by packages/language-server/package.json, \
                 or configure lsp.ppphp-ls.binary.path and binary.arguments.",
            )?;
            // Do not use std::path: the Wasm host and worktree may use different path styles.
            let bundle = format!("{}/{}", root.trim_end_matches(['/', '\\']), relative_path);
            let mut args = vec![bundle];
            args.extend(arguments.unwrap_or_else(|| vec!["--stdio".into()]));
            return Ok(Command {
                command: node,
                args,
                env: merge_env(shell_env(), extra_env),
            });
        }
    }

    if let Some(command) = which("ppphp-ls") {
        return Ok(Command {
            command,
            args: arguments.unwrap_or_else(|| vec!["--stdio".into()]),
            env: merge_env(shell_env(), extra_env),
        });
    }

    Err(
        "++PHP language server not found. Build it with 'php scripts/build.php server' \
         in ppphp-language-server, then set lsp.ppphp-ls.binary.path to Node.js and \
         binary.arguments to [the absolute path to dist/server.cjs, \"--stdio\"]. \
         Alternatively, put a ppphp-ls executable on the project host's PATH."
            .into(),
    )
}

fn merge_env(
    mut inherited: Vec<(String, String)>,
    overrides: Option<std::collections::HashMap<String, String>>,
) -> Vec<(String, String)> {
    if let Some(overrides) = overrides {
        inherited.retain(|(key, _)| !overrides.contains_key(key));
        inherited.extend(overrides);
    }
    inherited
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn binary(path: Option<&str>, arguments: Option<Vec<&str>>) -> CommandSettings {
        CommandSettings {
            path: path.map(str::to_string),
            arguments: arguments.map(|args| args.into_iter().map(str::to_string).collect()),
            env: None,
        }
    }

    #[test]
    fn configured_command_preserves_arguments_and_overrides_environment() {
        let mut config = binary(
            Some("/tools/node"),
            Some(vec!["/my server/server.cjs", "--stdio"]),
        );
        config.env = Some(HashMap::from([(
            "PPPHP_COMPILER_PATH".into(),
            "/new/compiler".into(),
        )]));
        let command = resolve(
            Some(config),
            "/project",
            |_| panic!("an explicit command must bypass discovery"),
            |_| None,
            || {
                vec![
                    ("PATH".into(), "/tools".into()),
                    ("PPPHP_COMPILER_PATH".into(), "/old".into()),
                ]
            },
        )
        .unwrap();
        assert_eq!(command.command, "/tools/node");
        assert_eq!(command.args, ["/my server/server.cjs", "--stdio"]);
        assert_eq!(command.env.len(), 2);
        assert!(command
            .env
            .contains(&("PPPHP_COMPILER_PATH".into(), "/new/compiler".into())));
        assert!(command.env.contains(&("PATH".into(), "/tools".into())));
    }

    #[test]
    fn configured_command_name_is_resolved_on_the_worktree_host() {
        let command = resolve(
            Some(binary(Some("node"), Some(vec![]))),
            "/project",
            |_| false,
            |name| (name == "node").then(|| "/remote/node".into()),
            Vec::new,
        )
        .unwrap();
        assert_eq!(command.command, "/remote/node");
        assert!(command.args.is_empty());
    }

    #[test]
    fn project_bundle_precedes_repository_bundle_and_path_executable() {
        let mut visited = Vec::new();
        let command = resolve(
            None,
            "/my project/",
            |path| {
                visited.push(path.to_string());
                true
            },
            |name| Some(format!("/bin/{name}")),
            Vec::new,
        )
        .unwrap();
        assert_eq!(visited, [BUNDLES[0]]);
        assert_eq!(command.command, "/bin/node");
        assert_eq!(
            command.args,
            [
                "/my project/node_modules/@ppphp/language-server/dist/server.cjs",
                "--stdio"
            ]
        );
    }

    #[test]
    fn repository_bundle_preserves_windows_worktree_path_and_argument_override() {
        let command = resolve(
            Some(binary(None, Some(vec!["--stdio", "--trace"]))),
            r"C:\My Project\",
            |path| path == BUNDLES[1],
            |name| (name == "node").then(|| r"C:\Node\node.exe".into()),
            Vec::new,
        )
        .unwrap();
        assert_eq!(command.command, r"C:\Node\node.exe");
        assert_eq!(
            command.args,
            [
                r"C:\My Project/packages/language-server/dist/server.cjs",
                "--stdio",
                "--trace"
            ]
        );
    }

    #[test]
    fn path_executable_works_without_node_or_a_bundle() {
        let command = resolve(
            None,
            "/project",
            |_| false,
            |name| (name == "ppphp-ls").then(|| "/bin/ppphp-ls".into()),
            Vec::new,
        )
        .unwrap();
        assert_eq!(command.command, "/bin/ppphp-ls");
        assert_eq!(command.args, ["--stdio"]);
    }

    #[test]
    fn discovery_is_repeated_for_each_worktree() {
        for root in ["/first", "/second"] {
            let command = resolve(
                None,
                root,
                |path| path == BUNDLES[1],
                |_| Some("/node".into()),
                Vec::new,
            )
            .unwrap();
            assert_eq!(command.args[0], format!("{root}/{}", BUNDLES[1]));
        }
    }

    #[test]
    fn missing_server_and_missing_runtime_have_actionable_errors() {
        let missing = resolve(None, "/project", |_| false, |_| None, Vec::new).unwrap_err();
        assert!(missing.contains("php scripts/build.php server"));
        let missing_node = resolve(None, "/project", |_| true, |_| None, Vec::new).unwrap_err();
        assert!(missing_node.contains("Node.js"));
        assert!(resolve(
            Some(binary(Some(" "), None)),
            "/project",
            |_| false,
            |_| None,
            Vec::new
        )
        .unwrap_err()
        .contains("must not be empty"));
    }
}
