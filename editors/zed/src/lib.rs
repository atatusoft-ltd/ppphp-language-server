use zed::settings::LspSettings;
use zed_extension_api::{self as zed, serde_json, LanguageServerId, Result};

mod managed_server;
mod server_command;

struct PpphpExtension;

impl zed::Extension for PpphpExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let settings = LspSettings::for_worktree(language_server_id.as_ref(), worktree)?;
        server_command::resolve(
            settings.binary,
            &worktree.root_path(),
            |path| worktree.read_text_file(path).is_ok(),
            |name| worktree.which(name),
            || worktree.shell_env(),
            || install_managed_server(language_server_id),
        )
    }

    fn language_server_initialization_options(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<serde_json::Value>> {
        Ok(
            LspSettings::for_worktree(language_server_id.as_ref(), worktree)?
                .initialization_options,
        )
    }

    fn language_server_workspace_configuration(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<serde_json::Value>> {
        // The server requests the "ppphp" section of this object via workspace/configuration.
        Ok(LspSettings::for_worktree(language_server_id.as_ref(), worktree)?.settings)
    }
}

fn install_managed_server(id: &LanguageServerId) -> Result<(String, String)> {
    // Zed invokes this on the project host, including WSL and SSH hosts.
    let node = zed::node_binary_path()?;
    let server = managed_server::install(
        std::path::Path::new("."),
        managed_server::VERSION,
        |url, path| {
            zed::set_language_server_installation_status(
                id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            zed::download_file(
                url,
                &path.to_string_lossy(),
                zed::DownloadedFileType::Uncompressed,
            )
        },
    )
    .map_err(|error| {
        zed::set_language_server_installation_status(
            id,
            &zed::LanguageServerInstallationStatus::Failed(error.clone()),
        );
        error
    })?;
    zed::set_language_server_installation_status(id, &zed::LanguageServerInstallationStatus::None);
    let path = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .join(server);
    Ok((node, path.to_string_lossy().into_owned()))
}
zed::register_extension!(PpphpExtension);
