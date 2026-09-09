package com.atatusoft.ppphp

import com.intellij.openapi.project.Project
import com.intellij.platform.lsp.api.LspServerManager

/** Registered only when the optional LSP module is available. */
class PpphpCompilerSettingsChangeListener(private val project: Project) : PpphpCompilerSettingsListener {
    override fun settingsChanged() {
        LspServerManager.getInstance(project).stopAndRestartIfNeeded(PpphpLspServerSupportProvider::class.java)
    }
}
