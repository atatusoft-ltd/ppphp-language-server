package com.atatusoft.ppphp

import com.intellij.openapi.extensions.PluginAware
import com.intellij.openapi.extensions.PluginDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.LspIntegrationProvider
import com.intellij.platform.lsp.api.LspIntegrationProvider.LspClientStarter
import java.nio.file.Path

class PpphpLspIntegrationProvider : LspIntegrationProvider, PluginAware {
    private lateinit var pluginRoot: Path

    override fun setPluginDescriptor(pluginDescriptor: PluginDescriptor) {
        pluginRoot = pluginDescriptor.pluginPath
    }

    override fun fileOpened(project: Project, file: VirtualFile, clientStarter: LspClientStarter) {
        if (file.extension.equals("ppp", ignoreCase = true)) {
            clientStarter.ensureClientStarted(PpphpLspClientDescriptor(project, pluginRoot))
        }
    }
}
