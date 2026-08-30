package com.atatusoft.ppphp

import com.intellij.lexer.Lexer
import com.intellij.lexer.LexerBase
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.fileTypes.SyntaxHighlighter
import com.intellij.openapi.fileTypes.SyntaxHighlighterFactory
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.tree.IElementType
import com.jetbrains.php.lang.PhpLanguage
import com.jetbrains.php.lang.lexer.PhpTokenTypes

private val contextualKeywordType =
    IElementType("++PHP contextual keyword", PpphpLanguage.INSTANCE)
private val contextualKeywordAttributes =
    arrayOf(
        TextAttributesKey.createTextAttributesKey(
            "PPPHP_CONTEXTUAL_KEYWORD",
            DefaultLanguageHighlighterColors.KEYWORD,
        ),
    )
private val contextualKeywords = setOf("throws", "when")

class PpphpSyntaxHighlighterFactory : SyntaxHighlighterFactory() {
    override fun getSyntaxHighlighter(
        project: Project?,
        virtualFile: VirtualFile?,
    ): SyntaxHighlighter {
        val phpHighlighter =
            SyntaxHighlighterFactory.getSyntaxHighlighter(
                PhpLanguage.INSTANCE,
                project,
                virtualFile,
            )
        return PpphpSyntaxHighlighter(phpHighlighter)
    }
}

private class PpphpSyntaxHighlighter(
    private val phpHighlighter: SyntaxHighlighter,
) : SyntaxHighlighter {
    override fun getHighlightingLexer(): Lexer =
        PpphpContextualKeywordLexer(phpHighlighter.highlightingLexer)

    override fun getTokenHighlights(tokenType: IElementType): Array<TextAttributesKey> =
        if (tokenType === contextualKeywordType) {
            contextualKeywordAttributes
        } else {
            phpHighlighter.getTokenHighlights(tokenType)
        }
}

private class PpphpContextualKeywordLexer(
    private val phpLexer: Lexer,
) : LexerBase() {
    override fun start(
        buffer: CharSequence,
        startOffset: Int,
        endOffset: Int,
        initialState: Int,
    ) {
        phpLexer.start(buffer, startOffset, endOffset, initialState)
    }

    override fun getState(): Int = phpLexer.state

    override fun getTokenType(): IElementType? =
        if (
            phpLexer.tokenType === PhpTokenTypes.IDENTIFIER &&
                phpLexer.tokenText in contextualKeywords
        ) {
            contextualKeywordType
        } else {
            phpLexer.tokenType
        }

    override fun getTokenStart(): Int = phpLexer.tokenStart

    override fun getTokenEnd(): Int = phpLexer.tokenEnd

    override fun advance() {
        phpLexer.advance()
    }

    override fun getBufferSequence(): CharSequence = phpLexer.bufferSequence

    override fun getBufferEnd(): Int = phpLexer.bufferEnd
}
