package com.atatusoft.ppphp

import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.fileTypes.SyntaxHighlighter
import com.intellij.openapi.fileTypes.SyntaxHighlighterFactory
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.tree.IElementType
import com.jetbrains.php.lang.PhpLanguage

private val contextualKeywordAttributes =
    arrayOf(
        TextAttributesKey.createTextAttributesKey(
            "PPPHP_CONTEXTUAL_KEYWORD",
            DefaultLanguageHighlighterColors.KEYWORD,
        ),
    )
private val typeNameAttributes =
    arrayOf(
        TextAttributesKey.createTextAttributesKey(
            "PPPHP_TYPE_NAME",
            DefaultLanguageHighlighterColors.CLASS_NAME,
        ),
    )

class PpphpSyntaxHighlighterFactory : SyntaxHighlighterFactory() {
    override fun getSyntaxHighlighter(
        project: Project?,
        virtualFile: VirtualFile?,
    ): SyntaxHighlighter {
        val phpHighlighter =
            requireNotNull(
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
    override fun getHighlightingLexer() =
        PpphpLexer(
            phpHighlighter.highlightingLexer,
            phpHighlighter.highlightingLexer,
        )

    override fun getTokenHighlights(tokenType: IElementType): Array<TextAttributesKey> =
        when (tokenType) {
            PpphpTokenTypes.CONTEXTUAL_KEYWORD -> contextualKeywordAttributes
            PpphpTokenTypes.TYPE_NAME -> typeNameAttributes
            else -> {
                val phpTokenType = PpphpTokenTypes.unwrap(tokenType) ?: return emptyArray()
                phpHighlighter.getTokenHighlights(phpTokenType)
            }
        }
}
