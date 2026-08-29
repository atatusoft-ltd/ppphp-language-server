package com.atatusoft.ppphp

import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.LspIntegrationProvider
import com.intellij.platform.lsp.api.LspIntegrationProvider.LspClientStarter

class PpphpLspIntegrationProvider : LspIntegrationProvider {
    override fun fileOpened(project: Project, file: VirtualFile, clientStarter: LspClientStarter) {
        if (file.extension.equals("ppp", ignoreCase = true)) {
            clientStarter.ensureClientStarted(PpphpLspClientDescriptor(project))
        }
    }
}
