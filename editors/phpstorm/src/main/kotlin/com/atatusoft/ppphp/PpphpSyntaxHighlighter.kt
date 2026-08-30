package com.atatusoft.ppphp

import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.fileTypes.SyntaxHighlighter
import com.intellij.openapi.fileTypes.SyntaxHighlighterFactory
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.tree.IElementType
import com.jetbrains.php.lang.PhpLanguage

class PpphpSyntaxHighlighterFactory : SyntaxHighlighterFactory() {
    override fun getSyntaxHighlighter(
        project: Project?,
        virtualFile: VirtualFile?,
    ): SyntaxHighlighter {
        val phpHighlighter = requireNotNull(
            SyntaxHighlighterFactory.getSyntaxHighlighter(
                PhpLanguage.INSTANCE,
                project,
                virtualFile,
            ),
        )
        return PpphpSyntaxHighlighter(phpHighlighter)
    }
}

private class PpphpSyntaxHighlighter(
    private val phpHighlighter: SyntaxHighlighter,
) : SyntaxHighlighter {
    override fun getHighlightingLexer() = PpphpLexer(phpHighlighter.highlightingLexer)

    override fun getTokenHighlights(tokenType: IElementType): Array<TextAttributesKey> {
        val phpTokenType = PpphpTokenTypes.unwrap(tokenType) ?: return emptyArray()
        return phpHighlighter.getTokenHighlights(phpTokenType)
    }
}
