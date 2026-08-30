package com.atatusoft.ppphp

import com.intellij.openapi.extensions.PluginAware
import com.intellij.openapi.extensions.PluginDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.LspServerSupportProvider
import java.nio.file.Path

class PpphpLspServerSupportProvider : LspServerSupportProvider, PluginAware {
    private lateinit var pluginRoot: Path

    override fun setPluginDescriptor(pluginDescriptor: PluginDescriptor) {
        pluginRoot = pluginDescriptor.pluginPath
    }

    override fun fileOpened(
        project: Project,
        file: VirtualFile,
        serverStarter: LspServerSupportProvider.LspServerStarter,
    ) {
        if (file.extension.equals("ppphp", ignoreCase = true)) {
            serverStarter.ensureServerStarted(PpphpLspServerDescriptor(project, pluginRoot))
        }
    }
}
