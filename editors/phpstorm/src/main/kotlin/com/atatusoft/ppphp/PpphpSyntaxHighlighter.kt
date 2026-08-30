package com.atatusoft.ppphp

import com.intellij.openapi.fileTypes.SyntaxHighlighter
import com.intellij.openapi.fileTypes.SyntaxHighlighterFactory
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import org.jetbrains.plugins.textmate.language.syntax.highlighting.TextMateSyntaxHighlighterFactory

class PpphpSyntaxHighlighterFactory : SyntaxHighlighterFactory() {
    private val textMateFactory = TextMateSyntaxHighlighterFactory()

    override fun getSyntaxHighlighter(
        project: Project?,
        virtualFile: VirtualFile?,
    ): SyntaxHighlighter = textMateFactory.getSyntaxHighlighter(project, virtualFile)
}
